// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc, onSnapshot, query, where, getDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInAnonymously,
    reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// Import Firebase configuration
import { firebaseConfig } from "./firebase-config.js";
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global listeners for real-time data
let studentsUnsubscribe = null;
let facultiesUnsubscribe = null;
let administratorsUnsubscribe = null;
let studentsCache = [];
let facultiesCache = [];
let administratorsCache = [];
let initialAuthChecked = false; // Flag to handle initial load
let currentStream = null;
let editingId = null;
let editingType = '';
let countdownInterval; // For attendance countdowns

document.addEventListener('DOMContentLoaded', () => {
    const menuItems = document.querySelectorAll('.menu-item');
    const contentBox = document.getElementById('content-display');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMessage = document.getElementById('loading-message');
    const logoutBtn = document.getElementById('logout-btn');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const mainLayout = document.querySelector('.main-layout');

    if (menuToggleBtn && mainLayout) {
        menuToggleBtn.addEventListener('click', () => {
            mainLayout.classList.toggle('sidebar-collapsed');
        });
    }

    // --- Custom Modal Logic ---
    const customModal = document.getElementById('custom-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalOkBtn = document.getElementById('modal-ok-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalPasswordInput = document.getElementById('modal-password');


    function showAlert(message) {
        return new Promise((resolve) => {
            modalMessage.textContent = message;
            modalPasswordInput.style.display = 'none';
            modalCancelBtn.style.display = 'none';
            modalOkBtn.style.display = 'inline-block';
            customModal.classList.add('visible');
            modalOkBtn.onclick = () => {
                customModal.classList.remove('visible');
                resolve(true);
            };
        });
    }

    function showConfirm(message) {
        return new Promise((resolve) => {
            modalMessage.textContent = message;
            modalPasswordInput.style.display = 'none';
            modalCancelBtn.style.display = 'inline-block';
            modalOkBtn.style.display = 'inline-block';
            customModal.classList.add('visible');
            modalOkBtn.onclick = () => {
                customModal.classList.remove('visible');
                resolve(true);
            };
            modalCancelBtn.onclick = () => {
                customModal.classList.remove('visible');
                resolve(false);
            };
        });
    }

    function showPasswordConfirm(message) {
        return new Promise((resolve) => {
            modalMessage.textContent = message;
            modalPasswordInput.value = '';
            modalPasswordInput.style.display = 'block';
            modalCancelBtn.style.display = 'inline-block';
            modalOkBtn.style.display = 'inline-block';
            customModal.classList.add('visible');

            modalOkBtn.onclick = () => {
                customModal.classList.remove('visible');
                modalPasswordInput.style.display = 'none';
                resolve(modalPasswordInput.value); // Resolve with the password
            };

            modalCancelBtn.onclick = () => {
                customModal.classList.remove('visible');
                modalPasswordInput.style.display = 'none';
                resolve(null); // Resolve with null if cancelled
            };
        });
    }

    // --- Edit Attendance Modal Logic ---
    const editAttendanceModal = document.getElementById('edit-attendance-modal');
    const editEntryTimeInput = document.getElementById('edit-entry-time');
    const editExitTimeInput = document.getElementById('edit-exit-time');
    const editModalSaveBtn = document.getElementById('edit-modal-save-btn');
    const editModalCancelBtn = document.getElementById('edit-modal-cancel-btn');
    let currentEditAttendanceParams = null;

    if (editModalCancelBtn) {
        editModalCancelBtn.onclick = () => {
            editAttendanceModal.classList.remove('visible');
            currentEditAttendanceParams = null;
        };
    }

    if (editModalSaveBtn) {
        editModalSaveBtn.onclick = async () => {
            if (!currentEditAttendanceParams) return;
            const { date, personId, type } = currentEditAttendanceParams;
            const entryTime = editEntryTimeInput.value.trim();
            const exitTime = editExitTimeInput.value.trim();

            if (!entryTime) {
                showAlert('Entry time is required.');
                return;
            }

            const attendanceCollectionName = `${type}_attendance`;
            const docRef = doc(db, attendanceCollectionName, date);

            const updateData = {
                status: 'Present',
                entryTime: entryTime
            };

            if (exitTime) {
                updateData.exitTime = exitTime;
            } else {
                updateData.exitTime = deleteField(); // Remove exit time if cleared
            }

            try {
                await setDoc(docRef, { records: { [personId]: updateData } }, { merge: true });
                showAlert('Attendance updated successfully.');
                editAttendanceModal.classList.remove('visible');
                // Refresh the list
                renderAttendanceSheet(date, type, `${type}-attendance-sheet-container`);
            } catch (error) {
                console.error("Error updating attendance:", error);
                showAlert('Failed to update attendance.');
            }
        };
    }

    // --- Face-API Model Loading ---
    async function loadFaceApiModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
        try {
            loadingMessage.textContent = 'Loading Core Model...';
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
            loadingMessage.textContent = 'Loading Landmarks Model...';
            await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
            loadingMessage.textContent = 'Loading Recognition Model...';
            await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
            loadingMessage.textContent = 'Loading Expression Model...';
            await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
            loadingOverlay.style.display = 'none';
        } catch (error) {
            loadingMessage.textContent = 'Failed to load models. Please refresh.';
            console.error('Model loading failed:', error);
        }
    }
    loadFaceApiModels();


    // --- Firestore Data Fetching ---
    function listenToStudents() {
        if (studentsUnsubscribe) studentsUnsubscribe();
        studentsUnsubscribe = onSnapshot(collection(db, "students"), (snapshot) => {
            studentsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('studentList')) renderStudents();
        });
    }

    function listenToFaculties() {
        if (facultiesUnsubscribe) facultiesUnsubscribe();
        facultiesUnsubscribe = onSnapshot(collection(db, "faculties"), (snapshot) => {
            facultiesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('facultyList')) renderFaculties();
        });
    }

    function listenToAdministrators() {
        if (administratorsUnsubscribe) administratorsUnsubscribe();
        administratorsUnsubscribe = onSnapshot(collection(db, "administrators"), (snapshot) => {
            administratorsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('administratorList')) renderAdministrators();
        });
    }

    // --- ATTENDANCE PERCENTAGE CALCULATION ---
    async function calculateAttendancePercentage(personId, type) {
        const collectionName = `${type}_attendance`;
        const q = collection(db, collectionName);
        try {
            const querySnapshot = await getDocs(q);
            const totalDays = querySnapshot.size;
            let presentDays = 0;

            if (totalDays === 0) {
                return 'N/A';
            }

            querySnapshot.forEach(doc => {
                const records = doc.data().records;
                if (records && records.hasOwnProperty(personId)) {
                    const record = records[personId];
                    if (record === 'Present' || (typeof record === 'object' && record.status === 'Present')) {
                        presentDays++;
                    }
                }
            });

            const percentage = (presentDays / totalDays) * 100;
            return `${percentage.toFixed(1)}%`;
        } catch (error) {
            console.error(`Error calculating attendance for ${personId}:`, error);
            return 'Error';
        }
    }


    const mainContent = {
        'student-data': `
            <h3>Student Data</h3>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="add-student">Add New Student</button>
            </div>
            <div id="studentList" class="available-list"></div>`,
        'faculty-data': `
            <h3>Faculty Data</h3>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="add-faculty">Add New Faculty</button>
            </div>
            <div id="facultyList" class="available-list"></div>`,
        'administrator': `
            <h3>Administrator Data</h3>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="add-administrator">Add New Administrator</button>
            </div>
            <div id="administratorList" class="available-list"></div>
            <hr>
            <h3>Administrator Attendance Dashboard</h3>
            <div class="attendance-options">
                <input type="date" id="administrator-attendance-date">
                <button id="view-administrator-attendance-btn">View Historical</button>
            </div>
             <h4>Mark Today's Attendance:</h4>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="mark-administrator-attendance-manual">Manually</button>
            </div>
            <div id="administrator-attendance-sheet-container" class="available-list"></div>
            <hr>
`,
        'face-attendance': `
            <h3>Face Attendance</h3>
            <div class="attendance-type-selector">
                <label><input type="radio" name="attendanceType" value="student" checked> Student</label>
                <label><input type="radio" name="attendanceType" value="faculty"> Faculty</label>
                <label><input type="radio" name="attendanceType" value="administrator"> Administrator</label>
            </div>
            <div class="camera-container">
                 <video id="video-stream" width="400" height="300" autoplay muted></video>
                 <button id="capture-image" class="camera-button">Capture</button>
                 <canvas id="photo-canvas" width="400" height="300" style="display:none;"></canvas>
                 <div id="capture-message"></div>
            </div>`,
        'student-attendance': `
            <h3>Student Attendance Dashboard</h3>
            <div class="attendance-options">
                <input type="date" id="student-attendance-date">
                <button id="view-student-attendance-btn">View Historical</button>
            </div>
            <div id="student-attendance-sheet-container" class="available-list"></div>`,
        'faculty-attendance': `
            <h3>Faculty Attendance Dashboard</h3>
            <div class="attendance-options">
                <input type="date" id="faculty-attendance-date">
                <button id="view-faculty-attendance-btn">View Historical</button>
            </div>
            <div id="faculty-attendance-sheet-container" class="available-list"></div>`,
        'analytics': `
            <h3>Smart Analytics Dashboard</h3>
            <div class="charts-container" style="display: flex; flex-wrap: wrap; gap: 20px; justify-content: center;">
                <div style="width: 45%; min-width: 300px; background: rgba(255,255,255,0.6); padding: 15px; border-radius: 8px;">
                    <canvas id="attendanceTrendsChart"></canvas>
                </div>
                <div style="width: 45%; min-width: 300px; background: rgba(255,255,255,0.6); padding: 15px; border-radius: 8px;">
                    <canvas id="presentAbsentChart"></canvas>
                </div>
                <div style="width: 90%; min-width: 300px; background: rgba(255,255,255,0.6); padding: 15px; border-radius: 8px;">
                    <canvas id="categoryComparisonChart"></canvas>
                </div>
            </div>`
    };

    const subContent = {
        'mark-student-attendance-manual': `
            <button class="form-button back-button" data-back-to="student-attendance">Back to Dashboard</button>
            <h3>Mark Student Attendance Manually for Today</h3>
            <div id="student-manual-attendance-sheet" class="available-list"></div>
            `,
        'mark-faculty-attendance-manual': `
            <button class="form-button back-button" data-back-to="faculty-attendance">Back to Dashboard</button>
            <h3>Mark Faculty Attendance Manually for Today</h3>
            <div id="faculty-manual-attendance-sheet" class="available-list"></div>
            `,
        'mark-administrator-attendance-manual': `
            <button class="form-button back-button" data-back-to="administrator">Back to Dashboard</button>
            <h3>Mark Administrator Attendance Manually for Today</h3>
            <div id="administrator-manual-attendance-sheet" class="available-list"></div>
            `,
        'add-student': `
            <button class="form-button back-button" data-back-to="student-data">Back</button>
            <h4>Add New Student</h4>
            <form class="form-container" id="add-student-form">
                <div class="form-grid">
                    <div class="form-fields">
                        <img id="studentImagePreview" class="form-image-preview" src="" alt="Image Preview">
                        <label for="studentName">Name:</label><input type="text" id="studentName" required>
                        <label for="studentId">Student ID:</label><input type="text" id="studentId" required>
                        <label for="studentBranch">Branch/Sec:</label><input type="text" id="studentBranch" required>
                        <label for="studentEmail">Email:</label><input type="email" id="studentEmail" placeholder="parent@example.com">
                        <label for="studentPhone">Phone Number:</label><input type="text" id="studentPhone">
                    </div>
                    <div class="camera-section">
                        <div class="video-capture-wrapper">
                            <video id="student-video" autoplay muted></video>
                            <canvas id="student-canvas" width="400" height="300"></canvas>
                        </div>
                        <button type="button" class="camera-button" id="openCameraBtnStudent">Open Camera</button>
                    </div>
                </div>
                <button type="submit" class="form-button" id="saveStudentBtn" style="margin-top: 15px; width: 100%;">Save Student</button>
            </form>`,
        'add-faculty': `
            <button class="form-button back-button" data-back-to="faculty-data">Back</button>
            <h4>Add New Faculty</h4>
            <form class="form-container" id="add-faculty-form">
                <div class="form-grid">
                    <div class="form-fields">
                        <img id="facultyImagePreview" class="form-image-preview" src="" alt="Image Preview">
                        <label for="facultyName">Name:</label><input type="text" id="facultyName" required>
                        <label for="facultyId">Faculty ID:</label><input type="text" id="facultyId" required>
                        <label for="facultyEmail">Email:</label><input type="email" id="facultyEmail" placeholder="faculty@example.com">
                        <label for="facultyPhone">Phone Number:</label><input type="text" id="facultyPhone">
                    <div class="camera-section">
                        <div class="video-capture-wrapper">
                            <video id="faculty-video" autoplay muted></video>
                            <canvas id="faculty-canvas" width="400" height="300"></canvas>
                        </div>
                        <button type="button" class="camera-button" id="openCameraBtnFaculty">Open Camera</button>
                    </div>
                </div>
                <button type="submit" class="form-button" id="saveFacultyBtn" style="margin-top: 15px; width: 100%;">Save Faculty</button>
            </form>`,
        'add-administrator': `
            <button class="form-button back-button" data-back-to="administrator">Back</button>
            <h4>Add New Administrator</h4>
            <form class="form-container" id="add-administrator-form">
                <div class="form-grid">
                    <div class="form-fields">
                        <img id="administratorImagePreview" class="form-image-preview" src="" alt="Image Preview">
                        <label for="administratorName">Name:</label><input type="text" id="administratorName" required>
                        <label for="administratorEmail">Email:</label><input type="email" id="administratorEmail" required>
                        <label for="administratorRole">Role:</label><input type="text" id="administratorRole" placeholder="e.g., Admin, Manager" required>
                    </div>
                    <div class="camera-section">
                        <div class="video-capture-wrapper">
                            <video id="administrator-video" autoplay muted></video>
                            <canvas id="administrator-canvas" width="400" height="300"></canvas>
                        </div>
                        <button type="button" class="camera-button" id="openCameraBtnAdministrator">Open Camera</button>
                    </div>
                </div>
                <button type="submit" class="form-button" id="saveAdministratorBtn" style="margin-top: 15px; width: 100%;">Save Administrator</button>
            </form>`,
    };

    function stopCamera(streamToStop) {
        if (streamToStop) {
            streamToStop.getTracks().forEach(track => track.stop());
            currentStream = null;
        }
    }

    function getFormattedDate(date) {
        return date.toISOString().split('T')[0];
    }

    // --- Geofencing Helper ---
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    let TARGET_LAT = 28.682025; // Faculty Target - Updated
    let TARGET_LNG = 77.508481;
    let ADMIN_TARGET_LAT = 28.682025; // Administrator Target - Updated
    let ADMIN_TARGET_LNG = 77.508481;
    let ALLOWED_RADIUS = 50; // meters

    // Helper to verify location for Faculty
    async function verifyLocation(type) {
        if (type !== 'faculty') return null; // Only check for faculty

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
            });

            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            const distance = calculateDistance(userLat, userLng, TARGET_LAT, TARGET_LNG);

            if (distance > ALLOWED_RADIUS) {
                throw new Error(`Attendance Rejected: You are ${distance.toFixed(0)}m away. (Allowed: ${ALLOWED_RADIUS}m) \nYour Loc: ${userLat.toFixed(6)}, ${userLng.toFixed(6)} \nTarget: ${TARGET_LAT}, ${TARGET_LNG}`);
            }

            return {
                lat: userLat,
                lng: userLng,
                distance: distance,
                accuracy: position.coords.accuracy
            };
        } catch (error) {
            // Re-throw specific distance error, or generic location error
            if (error.message.includes('Attendance Rejected')) throw error;
            throw new Error(`Location access required for ${type} attendance.`);
        }
    }

    async function fetchGeofencingSettings() {
        try {
            const docRef = doc(db, "settings", "geofencing");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                // if (data.facultyLat) TARGET_LAT = parseFloat(data.facultyLat);
                // if (data.facultyLng) TARGET_LNG = parseFloat(data.facultyLng);
                // if (data.adminLat) ADMIN_TARGET_LAT = parseFloat(data.adminLat);
                // if (data.adminLng) ADMIN_TARGET_LNG = parseFloat(data.adminLng);
                // if (data.radius) ALLOWED_RADIUS = parseFloat(data.radius);
                console.log("Geofencing settings loaded (but ignored to enforce defaults):", data);
            } else {
                console.log("No geofencing settings found, using defaults.");
            }
        } catch (error) {
            console.error("Error fetching geofencing settings:", error);
        }
    }

    onAuthStateChanged(auth, user => {
        // Always listen effectively for public usage (anonymous or admin)
        listenToStudents();
        listenToFaculties();

        if (user && !user.isAnonymous) {
            // User is a logged-in administrator
            logoutBtn.style.display = 'block';
            listenToAdministrators();
        } else {
            // User is anonymous or logged out
            logoutBtn.style.display = 'none';
            if (administratorsUnsubscribe) administratorsUnsubscribe();
            administratorsCache = [];
        }

        // This block runs only ONCE on initial page load after auth state is confirmed
        if (!initialAuthChecked) {
            initialAuthChecked = true;
            const defaultContentId = 'face-attendance';
            updateMainContent(defaultContentId);

            const defaultMenuItem = document.querySelector(`.menu-item[data-content-id="${defaultContentId}"]`);
            if (defaultMenuItem) defaultMenuItem.classList.add('active');
        }
    });

    function renderLogin(targetContentId) {
        contentBox.innerHTML = `
            <form id="login-form" class="form-container">
                <label for="adminEmailLogin">Email:</label>
                <input type="email" id="adminEmailLogin" required>
                <label for="adminPasswordLogin">Password:</label>
                <input type="password" id="adminPasswordLogin" required>
                <button type="submit" class="form-button" style="width: 100%;">Login</button>
            </form>
        `;
        document.getElementById('login-form').addEventListener('submit', (e) => {
            handleLogin(e, targetContentId);
        });
    }



    async function handleLogin(e, targetContentId) {
        e.preventDefault();
        const email = document.getElementById('adminEmailLogin').value;
        const pass = document.getElementById('adminPasswordLogin').value;

        loadingOverlay.style.display = 'flex';
        loadingMessage.textContent = 'Logging in...';

        try {
            await signInWithEmailAndPassword(auth, email, pass);
            loadingOverlay.style.display = 'none';
            menuItems.forEach(item => item.classList.toggle('active', item.dataset.contentId === targetContentId));
            updateMainContent(targetContentId);
        } catch (error) {
            loadingOverlay.style.display = 'none';
            showAlert(`Login failed: ${error.message}`);
        }
    }

    logoutBtn.addEventListener('click', async () => {
        await signOut(auth);
        const defaultContentId = 'face-attendance';
        menuItems.forEach(item => item.classList.remove('active'));
        const defaultMenuItem = document.querySelector(`.menu-item[data-content-id="${defaultContentId}"]`);
        if (defaultMenuItem) defaultMenuItem.classList.add('active');
        updateMainContent(defaultContentId);
    });

    // --- RENDER LISTS ---
    function renderStudents() {
        const listDiv = document.getElementById('studentList');
        if (!listDiv) return;
        if (studentsCache.length === 0) {
            listDiv.innerHTML = '<p>No students added yet.</p>';
            return;
        }
        const table = `<table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>Student ID</th><th>Branch/Sec</th><th>Attendance %</th><th>Actions</th></tr></thead><tbody>
                ${studentsCache.map((s, i) => `<tr>
                <td>${i + 1}</td>
                <td><img src="${s.imageUrl}" alt="Student Image"></td>
                <td>${s.name}</td><td>${s.studentId}</td><td>${s.studentBranch}</td>
                <td>${s.studentBranch}</td>
                <td data-percentage-id="${s.id}"><span class="loader-small"></span></td>
                <td><div class="action-buttons">
                    <button class="edit-btn" data-type="student" data-id="${s.id}">Edit</button>
                    <button class="delete-btn" data-type="student" data-id="${s.id}">Delete</button>
                </div></td>
            </tr>`).join('')}
            </tbody></table>`;
        listDiv.innerHTML = table;

        studentsCache.forEach(async (student) => {
            const percentage = await calculateAttendancePercentage(student.id, 'student');
            const cell = listDiv.querySelector(`td[data-percentage-id="${student.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }

    function renderFaculties() {
        const listDiv = document.getElementById('facultyList');
        if (!listDiv) return;
        if (facultiesCache.length === 0) {
            listDiv.innerHTML = '<p>No faculties added yet.</p>';
            return;
        }
        const table = `<table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>Faculty ID</th><th>Phone</th><th>Attendance %</th><th>Actions</th></tr></thead><tbody>
                ${facultiesCache.map((f, i) => `<tr>
                <td>${i + 1}</td>
                <td><img src="${f.imageUrl}" alt="Faculty Image"></td>
                <td>${f.name}</td><td>${f.facultyId}</td><td>${f.facultyPhone}</td>
                <td data-percentage-id="${f.id}"><span class="loader-small"></span></td>
                <td><div class="action-buttons">
                    <button class="edit-btn" data-type="faculty" data-id="${f.id}">Edit</button>
                    <button class="delete-btn" data-type="faculty" data-id="${f.id}">Delete</button>
                </div></td>
            </tr>`).join('')}
            </tbody></table>`;
        listDiv.innerHTML = table;

        facultiesCache.forEach(async (faculty) => {
            const percentage = await calculateAttendancePercentage(faculty.id, 'faculty');
            const cell = listDiv.querySelector(`td[data-percentage-id="${faculty.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }

    function renderAdministrators() {
        const listDiv = document.getElementById('administratorList');
        if (!listDiv) return;
        if (administratorsCache.length === 0) {
            listDiv.innerHTML = '<p>No administrators added yet.</p>';
            return;
        }
        const table = `<table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>Email</th><th>Role</th><th>Attendance %</th><th>Actions</th></tr></thead><tbody>
                ${administratorsCache.map((a, i) => `<tr>
                <td>${i + 1}</td>
                <td><img src="${a.imageUrl}" alt="Admin Image"></td>
                <td>${a.name}</td><td>${a.email}</td><td>${a.role}</td>
                <td data-percentage-id="${a.id}"><span class="loader-small"></span></td>
                <td><div class="action-buttons">
                    <button class="delete-btn" data-type="administrator" data-id="${a.id}">Delete</button>
                </div></td>
            </tr>`).join('')}
            </tbody></table>`;
        listDiv.innerHTML = table;

        administratorsCache.forEach(async (admin) => {
            const percentage = await calculateAttendancePercentage(admin.id, 'administrator');
            const cell = listDiv.querySelector(`td[data-percentage-id="${admin.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }

    // --- Generic Camera Setup for Forms ---
    function setupGenericCamera(type) {
        const video = document.getElementById(`${type}-video`);
        const canvas = document.getElementById(`${type}-canvas`);
        if (!video || !canvas) return; // In case the elements don't exist
        const context = canvas.getContext('2d');
        const openCameraBtn = document.getElementById(`openCameraBtn${type.charAt(0).toUpperCase() + type.slice(1)}`);
        const imagePreview = document.getElementById(`${type}ImagePreview`);

        openCameraBtn.onclick = async () => {
            if (currentStream && currentStream.active) {
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageDataURL = canvas.toDataURL('image/png');
                    imagePreview.src = imageDataURL;
                    imagePreview.style.display = 'block';
                    stopCamera(currentStream);
                    video.style.display = 'none';
                    openCameraBtn.textContent = 'Retake Image';
                    showAlert('Image captured!');
                } else {
                    showAlert('Camera is not ready yet. Please wait.');
                }
            } else {
                try {
                    const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    video.srcObject = mediaStream;
                    currentStream = mediaStream;
                    video.style.display = 'block';
                    openCameraBtn.textContent = 'Capture';
                } catch (err) {
                    showAlert('Camera access denied or not available.');
                }
            }
        };
    }

    // --- Generic Form Setup Logic with Face Detection ---
    async function setupAddFormListeners(type) {
        setupGenericCamera(type);
        const form = document.getElementById(`add-${type}-form`);
        const saveBtn = document.getElementById(`save${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);
        const imagePreview = document.getElementById(`${type}ImagePreview`);

        let isEditing = !!editingId;
        if (isEditing) {
            let data;
            if (type === 'student') {
                data = studentsCache.find(item => item.id === editingId);
            } else if (type === 'faculty') {
                data = facultiesCache.find(item => item.id === editingId);
            } else if (type === 'administrator') {
                data = administratorsCache.find(item => item.id === editingId);
            }

            if (data) {
                if (type === 'student') {
                    document.getElementById('studentName').value = data.name;
                    document.getElementById('studentId').value = data.studentId;
                    document.getElementById('studentBranch').value = data.studentBranch;
                    document.getElementById('studentEmail').value = data.studentEmail || '';
                    document.getElementById('studentPhone').value = data.studentPhone;
                } else if (type === 'faculty') {
                    document.getElementById('facultyName').value = data.name;
                    document.getElementById('facultyId').value = data.facultyId;
                    document.getElementById('facultyEmail').value = data.facultyEmail || '';
                    document.getElementById('facultyPhone').value = data.facultyPhone;
                } else if (type === 'administrator') {
                    document.getElementById('administratorName').value = data.name;
                    document.getElementById('administratorEmail').value = data.email;
                    document.getElementById('administratorRole').value = data.role;
                }
                imagePreview.src = data.imageUrl;
                imagePreview.style.display = 'block';
            }
            saveBtn.textContent = `Update ${type.charAt(0).toUpperCase() + type.slice(1)}`;
            document.querySelector('h4').textContent = `Edit ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        } else {
            document.querySelector('h4').textContent = `Add New ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            const imageUrl = imagePreview.src;
            if (!imageUrl || imageUrl.length < 100) {
                showAlert('Please capture an image before saving.'); return;
            }

            const detection = await faceapi.detectSingleFace(imagePreview, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
            if (!detection) {
                showAlert('No face was detected. Please retake the photo.'); return;
            }

            const descriptor = Array.from(detection.descriptor);
            let data = { imageUrl, descriptor };

            if (type === 'student') {
                data = {
                    ...data,
                    name: document.getElementById('studentName').value,
                    studentId: document.getElementById('studentId').value,
                    studentBranch: document.getElementById('studentBranch').value,
                    studentEmail: document.getElementById('studentEmail').value,
                    studentPhone: document.getElementById('studentPhone').value,
                };
            } else if (type === 'faculty') {
                data = {
                    ...data,
                    name: document.getElementById('facultyName').value,
                    facultyId: document.getElementById('facultyId').value,
                    facultyEmail: document.getElementById('facultyEmail').value,
                    facultyPhone: document.getElementById('facultyPhone').value,
                };
            } else if (type === 'administrator') {
                data = {
                    ...data,
                    name: document.getElementById('administratorName').value,
                    email: document.getElementById('administratorEmail').value,
                    role: document.getElementById('administratorRole').value,
                };
            }

            loadingOverlay.style.display = 'flex';
            loadingMessage.textContent = 'Saving data...';

            try {
                let collectionName;
                if (type === 'student') collectionName = "students";
                else if (type === 'faculty') collectionName = "faculties";
                else collectionName = "administrators";
                if (isEditing) {
                    const docRef = doc(db, collectionName, editingId);
                    await updateDoc(docRef, data);
                    showAlert(`${type} data updated successfully!`);
                } else {
                    await addDoc(collection(db, collectionName), data);
                    showAlert(`${type} data saved successfully!`);
                }
                updateMainContent(`${type}-data`);
            } catch (error) {
                showAlert(`Error saving data: ${error.message}`);
                messageDiv.textContent = 'Camera access denied or not available.';
                messageDiv.style.color = 'red';
            }
        }
    } // End setupAddFormListeners

    // --- ATTENDANCE LOGIC ---
    async function renderAttendanceSheet(date, type, containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error("Attendance container not found:", containerId);
            return;
        }
        container.innerHTML = `<div class="loader" style="margin: 40px auto;"></div>`;

        let database;
        if (type === 'student') database = studentsCache;
        else if (type === 'faculty') database = facultiesCache;
        else database = administratorsCache;

        const collectionName = `${type}_attendance`;
        let idField, secondaryField, secondaryFieldHeader;

        if (type === 'student') {
            idField = 'studentId'; secondaryField = 'studentId'; secondaryFieldHeader = 'Student ID';
        } else if (type === 'faculty') {
            idField = 'facultyId'; secondaryField = 'facultyId'; secondaryFieldHeader = 'Faculty ID';
        } else {
            idField = 'name'; secondaryField = 'role'; secondaryFieldHeader = 'Role';
        }

        if (database.length === 0) {
            container.innerHTML = `<p>No ${type}s registered. Please add them first.</p>`;
            return;
        }

        const attendanceDocRef = doc(db, collectionName, date);
        const attendanceDoc = await getDoc(attendanceDocRef);
        const dailyRecords = attendanceDoc.exists() ? attendanceDoc.data().records || {} : {};

        const today = getFormattedDate(new Date());
        const isEditable = date === today;

        let tableHTML = `<h4>Showing Attendance for: ${date} ${!isEditable && !containerId.includes('-manual-') ? '(View Only)' : ''}</h4>
            <table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>${secondaryFieldHeader}</th>`;

        if (type === 'faculty' || type === 'administrator') {
            tableHTML += `<th>Location</th>`;
        }

        tableHTML += `<th>Status</th><th>Entry Time</th><th>Exit Time</th><th>Overall %</th>`;

        // Only render Actions column header if Administrator
        if (type === 'administrator') {
            tableHTML += `<th>Actions</th>`;
        }

        tableHTML += `</tr></thead><tbody>`;

        database.forEach((person, index) => {
            const record = dailyRecords[person.id];
            const status = (typeof record === 'object' ? record.status : record) || 'Absent';
            const entryTime = (typeof record === 'object' ? record.entryTime : '') || '-';
            const exitTime = (typeof record === 'object' ? record.exitTime : '') || '-';
            const location = (typeof record === 'object' && record.location) ?
                `${record.location.lat.toFixed(4)}, ${record.location.lng.toFixed(4)}<br><span style="font-size:0.8em; color:gray;">(${record.location.distance ? Math.round(record.location.distance) : '?'}m away)</span>` : '-';
            const statusClass = status.toLowerCase();

            let timeOverWarning = '';
            let rowStyle = '';

            if (status === 'Present' && entryTime !== '-' && exitTime === '-') {
                // Logic for active session
            }

            // Status Toggle Button logic
            let statusElement;
            if (type === 'administrator' && isEditable) {
                statusElement = `<button class="status-toggle ${statusClass}" data-date="${date}" data-personid="${person.id}" data-type="${type}">${status}</button>`;
            } else {
                statusElement = `<span class="status-toggle ${statusClass}" style="cursor: default;">${status}</span>`;
            }

            tableHTML += `<tr ${rowStyle}>
                            <td>${index + 1}</td>
                            <td><img src="${person.imageUrl}" alt="${person.name}"></td>
                            <td>${person.name}</td>
                            <td>${person[secondaryField]}</td>`;

            if (type === 'faculty' || type === 'administrator') {
                tableHTML += `<td>${location}</td>`;
            }

            tableHTML += `<td>${statusElement}${timeOverWarning}</td>
                            <td>${entryTime}</td>
                            <td>${exitTime}</td>
                            <td data-percentage-id="${person.id}"><span class="loader-small"></span></td>`;

            // Render Actions cell only for Administrator
            if (type === 'administrator') {
                tableHTML += `<td>
                    <button class="edit-attendance-btn" data-date="${date}" data-personid="${person.id}" data-type="${type}" data-entry="${entryTime}" data-exit="${exitTime}">Edit</button>
                    <button class="delete-attendance-btn" data-date="${date}" data-personid="${person.id}" data-type="${type}">Delete</button>
                </td>`;
            }

            tableHTML += `</tr>`;
        });

        tableHTML += '</tbody></table>';
        container.innerHTML = tableHTML;

        database.forEach(async (person) => {
            const percentage = await calculateAttendancePercentage(person.id, type);
            const cell = container.querySelector(`td[data-percentage-id="${person.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }

    // --- Notification Logic ---
    function sendAttendanceEmail(person, status, time) {
        const serviceID = 'service_m3dzax8';
        const templateID = 'template_fieitqe';

        const templateParams = {
            to_name: person.name,
            to_email: person.email || person.studentEmail || person.facultyEmail || 'parent@example.com',
            status: status,
            time: time,
            message: `Attendance marked as ${status} at ${time}.`
        };

        emailjs.send(serviceID, templateID, templateParams)
            .then(() => {
                console.log('Email sent successfully!');
            }, (err) => {
                console.log('Failed to send email:', err);
            });
    }

    async function setupCombinedAttendanceCamera() {
        const video = document.getElementById('video-stream');
        const captureButton = document.getElementById('capture-image');
        const canvas = document.getElementById('photo-canvas');
        const messageDiv = document.getElementById('capture-message');
        const context = canvas.getContext('2d');

        try {
            if (!auth.currentUser || !auth.currentUser.isAnonymous) {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Anonymous sign-in failed.", error);
            if (messageDiv) {
                messageDiv.textContent = 'Error: Anonymous sign-in is not enabled in Firebase.';
                messageDiv.style.color = 'red';
            }
            showAlert('The attendance terminal could not start. Please go to your Firebase project -> Authentication -> Sign-in method and enable "Anonymous" sign-in.');
            return;
        }

        if (currentStream) stopCamera(currentStream);

        async function startCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = mediaStream;
                video.onloadedmetadata = () => { video.play(); };
                currentStream = mediaStream;
                video.style.display = 'block';
                captureButton.style.display = 'block';
                messageDiv.textContent = 'Camera is ready. Click Capture.';
                messageDiv.className = '';
                messageDiv.style.color = 'black';
            } catch (err) {
                messageDiv.textContent = 'Camera access denied or not available.';
                messageDiv.style.color = 'red';
            }
        }
        await startCamera();

        captureButton.onclick = async () => {
            if (video.readyState !== video.HAVE_ENOUGH_DATA) {
                showAlert('Camera is not ready.'); return;
            }
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            stopCamera(currentStream);
            video.style.display = 'none';
            captureButton.style.display = 'none';
            messageDiv.textContent = 'Image captured! Matching...';

            const type = document.querySelector('input[name="attendanceType"]:checked').value;
            let collectionName;
            if (type === 'student') collectionName = 'students';
            else if (type === 'faculty') collectionName = 'faculties';
            else collectionName = `${type}s`;

            let idField;
            if (type === 'student') idField = 'studentId';
            else if (type === 'faculty') idField = 'facultyId';
            else idField = 'name';

            const querySnapshot = await getDocs(collection(db, collectionName));
            const database = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            if (database.length === 0) {
                messageDiv.textContent = `No ${type}s registered.`;
                messageDiv.style.color = 'red';
                setTimeout(startCamera, 2000); return;
            }

            const labeledDescriptors = database
                .filter(p => p.descriptor)
                .map(p => new faceapi.LabeledFaceDescriptors(p[idField], [new Float32Array(p.descriptor)]));

            if (labeledDescriptors.length === 0) {
                messageDiv.textContent = `No ${type}s have a registered face.`;
                messageDiv.style.color = 'red';
                setTimeout(startCamera, 2000); return;
            }

            const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.45);
            const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor().withFaceExpressions();

            if (detection) {
                // Liveness Check: Require Smile
                const expressions = detection.expressions;
                if (expressions.happy < 0.7) {
                    messageDiv.textContent = 'Liveness Check Failed: Please SMILE to mark attendance!';
                    messageDiv.className = 'message-error';
                    setTimeout(startCamera, 3000);
                    return;
                }

                const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
                if (bestMatch.label !== 'unknown') {
                    const personIdValue = bestMatch.label;
                    const person = database.find(p => p[idField] === personIdValue);
                    if (person) {
                        const today = getFormattedDate(new Date());
                        const attendanceCollectionName = `${type}_attendance`;
                        const docRef = doc(db, attendanceCollectionName, today);

                        const attendanceDoc = await getDoc(docRef);
                        const dailyRecords = attendanceDoc.exists() ? attendanceDoc.data().records || {} : {};

                        if (dailyRecords[person.id]) {
                            const record = dailyRecords[person.id];
                            const status = typeof record === 'object' ? record.status : record;

                            if (status === 'Present') {
                                // Check if we need to mark exit time
                                if (typeof record === 'object' && record.entryTime && !record.exitTime) {
                                    const now = new Date().toLocaleTimeString();

                                    try {
                                        messageDiv.textContent = "Verifying location for exit...";
                                        const locationData = await verifyLocation(type);

                                        const updateData = {
                                            records: { [person.id]: { ...record, exitTime: now } }
                                        };
                                        if (locationData) {
                                            updateData.records[person.id].exitLocation = locationData;
                                        }

                                        await setDoc(docRef, updateData, { merge: true });
                                        messageDiv.textContent = `Exit time recorded for ${person.name} at ${now}.`;
                                        messageDiv.className = 'message-success';
                                        sendAttendanceEmail(person, 'Exit', now);
                                    } catch (error) {
                                        console.error("Exit attendance error:", error);
                                        messageDiv.textContent = error.message;
                                        messageDiv.className = 'message-error';
                                        setTimeout(startCamera, 3000);
                                        return;
                                    }
                                } else {
                                    messageDiv.textContent = `Attendance already completed for ${person.name}.`;
                                    messageDiv.style.color = '#ffc107';
                                }
                            } else {
                                // Was absent (or other status), now present
                                const now = new Date().toLocaleTimeString();

                                let locationData = null;
                                try {
                                    messageDiv.textContent = "Verifying location...";
                                    locationData = await verifyLocation(type);
                                } catch (error) {
                                    console.error("Entry attendance error:", error);
                                    messageDiv.textContent = error.message;
                                    messageDiv.className = 'message-error';
                                    setTimeout(startCamera, 3000);
                                    return;
                                }

                                const recordData = { status: 'Present', entryTime: now };
                                if (locationData) recordData.location = locationData;

                                await setDoc(docRef, {
                                    records: { [person.id]: recordData }
                                }, { merge: true });
                                messageDiv.textContent = `Attendance marked for ${person.name}!`;
                                if (locationData) messageDiv.textContent += " Location recorded.";
                                messageDiv.className = 'message-success';
                                sendAttendanceEmail(person, 'Present', now);
                            }
                        } else {
                            const now = new Date().toLocaleTimeString();

                            let locationData = null;
                            try {
                                messageDiv.textContent = "Verifying location...";
                                locationData = await verifyLocation(type);
                            } catch (error) {
                                console.error("Entry attendance error:", error);
                                messageDiv.textContent = error.message;
                                messageDiv.className = 'message-error';
                                setTimeout(startCamera, 3000);
                                return;
                            }

                            const recordData = { status: 'Present', entryTime: now };
                            if (locationData) recordData.location = locationData;

                            await setDoc(docRef, {
                                records: { [person.id]: recordData }
                            }, { merge: true });

                            const confidence = ((1 - bestMatch.distance) * 100).toFixed(2);
                            messageDiv.textContent = `Attendance marked for ${person.name}! (Confidence: ${confidence}%)`;
                            if (locationData) messageDiv.textContent += " Location recorded.";
                            messageDiv.className = 'message-success';
                            sendAttendanceEmail(person, 'Present', now);
                        }
                    }
                } else {
                    messageDiv.textContent = `Face detected, but no match found.`;
                    messageDiv.className = 'message-error';
                }
            } else {
                messageDiv.textContent = 'No face detected in the image.';
                messageDiv.className = 'message-error';
            }
            setTimeout(startCamera, 3000);
        };
    }

    // --- Analytics Logic ---
    async function renderAnalytics() {
        const today = getFormattedDate(new Date());

        // 1. Fetch Today's Attendance for All Categories
        const studentRef = doc(db, "student_attendance", today);
        const facultyRef = doc(db, "faculty_attendance", today);
        const adminRef = doc(db, "administrator_attendance", today);

        const [studentSnap, facultySnap, adminSnap] = await Promise.all([
            getDoc(studentRef), getDoc(facultyRef), getDoc(adminRef)
        ]);

        const studentRecords = studentSnap.exists() ? studentSnap.data().records || {} : {};
        const facultyRecords = facultySnap.exists() ? facultySnap.data().records || {} : {};
        const adminRecords = adminSnap.exists() ? adminSnap.data().records || {} : {};

        // Calculate Counts
        const countPresent = (records) => Object.values(records).filter(r => (r.status === 'Present' || r === 'Present')).length;

        const studentPresent = countPresent(studentRecords);
        const facultyPresent = countPresent(facultyRecords);
        const adminPresent = countPresent(adminRecords);

        const studentTotal = studentsCache.length;
        const facultyTotal = facultiesCache.length;
        const adminTotal = administratorsCache.length;

        // Chart 1: Attendance Trends (Mock Data for Demo - Real implementation needs historical query)
        const ctx1 = document.getElementById('attendanceTrendsChart').getContext('2d');
        new Chart(ctx1, {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                datasets: [{
                    label: 'Overall Attendance',
                    data: [65, 59, 80, 81, 56, 55], // Mock data
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                }]
            },
            options: { responsive: true, plugins: { title: { display: true, text: 'Weekly Attendance Trends' } } }
        });

        // Chart 2: Present vs Absent (Today)
        const totalPresent = studentPresent + facultyPresent + adminPresent;
        const totalTotal = studentTotal + facultyTotal + adminTotal;
        const totalAbsent = totalTotal - totalPresent;

        const ctx2 = document.getElementById('presentAbsentChart').getContext('2d');
        new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: ['Present', 'Absent'],
                datasets: [{
                    data: [totalPresent, totalAbsent],
                    backgroundColor: ['#28a745', '#dc3545']
                }]
            },
            options: { responsive: true, plugins: { title: { display: true, text: "Today's Attendance Status" } } }
        });

        // Chart 3: Category Comparison
        const ctx3 = document.getElementById('categoryComparisonChart').getContext('2d');
        new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: ['Students', 'Faculty', 'Administrators'],
                datasets: [
                    {
                        label: 'Present',
                        data: [studentPresent, facultyPresent, adminPresent],
                        backgroundColor: '#28a745'
                    },
                    {
                        label: 'Total',
                        data: [studentTotal, facultyTotal, adminTotal],
                        backgroundColor: '#6c757d'
                    }
                ]
            },
            options: { responsive: true, plugins: { title: { display: true, text: 'Attendance by Category' } } }
        });
    }

    // --- Content Update and Event Handling ---
    function updateMainContent(contentId) {
        stopCamera(currentStream);
        contentBox.innerHTML = mainContent[contentId];
        editingId = null; editingType = '';

        if (contentId === 'student-data') {
            renderStudents();
        } else if (contentId === 'faculty-data') {
            renderFaculties();
        } else if (contentId === 'administrator') {
            renderAdministrators();
            const datePicker = document.getElementById('administrator-attendance-date');
            if (datePicker) datePicker.value = getFormattedDate(new Date());


        } else if (contentId === 'face-attendance') {
            setupCombinedAttendanceCamera();
        } else if (contentId.includes('-attendance')) {
            const type = contentId.split('-')[0];
            const datePicker = document.getElementById(`${type}-attendance-date`);
            if (datePicker) datePicker.value = getFormattedDate(new Date());
        } else if (contentId === 'analytics') {
            renderAnalytics();
        }
    }

    function updateSubContent(contentId) {
        stopCamera(currentStream);
        contentBox.innerHTML = subContent[contentId];
        const today = getFormattedDate(new Date());
        if (contentId === 'add-student') {
            setupAddFormListeners('student');
        } else if (contentId === 'add-faculty') {
            setupAddFormListeners('faculty');
        } else if (contentId === 'add-administrator') {
            setupAddFormListeners('administrator');
        } else if (contentId === 'mark-student-attendance-manual') {
            renderAttendanceSheet(today, 'student', 'student-manual-attendance-sheet');
        } else if (contentId === 'mark-faculty-attendance-manual') {
            renderAttendanceSheet(today, 'faculty', 'faculty-manual-attendance-sheet');
        } else if (contentId === 'mark-administrator-attendance-manual') {
            renderAttendanceSheet(today, 'administrator', 'administrator-manual-attendance-sheet');
        }
    }

    contentBox.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.classList.contains('sub-option')) {
            updateSubContent(target.getAttribute('data-sub-content'));
        } else if (target.classList.contains('back-button')) {
            updateMainContent(target.getAttribute('data-back-to'));
        } else if (target.id === 'view-student-attendance-btn' || target.id === 'view-faculty-attendance-btn' || target.id === 'view-administrator-attendance-btn') {
            const type = target.id.split('-')[1];
            const date = document.getElementById(`${type}-attendance-date`).value;
            if (!date) { showAlert('Please select a date.'); return; }
            renderAttendanceSheet(date, type, `${type}-attendance-sheet-container`);
        } else if (target.classList.contains('status-toggle') && target.tagName === 'BUTTON') {
            const date = target.dataset.date;
            const personId = target.dataset.personid;
            const type = target.dataset.type;
            const attendanceCollectionName = `${type}_attendance`;
            const docRef = doc(db, attendanceCollectionName, date);
            const currentStatus = target.textContent;
            const newStatus = currentStatus === 'Present' ? 'Absent' : 'Present';
            const now = new Date().toLocaleTimeString();

            const newRecord = newStatus === 'Present' ? { status: 'Present', entryTime: now } : { status: 'Absent' };

            try {
                await setDoc(docRef, { records: { [personId]: newRecord } }, { merge: true });
                target.textContent = newStatus;
                target.className = `status-toggle ${newStatus.toLowerCase()}`;
            } catch (error) {
                showAlert('Failed to update status.');
                console.error("Status update error:", error);
            }
        } else if (target.classList.contains('delete-btn')) {
            const id = target.getAttribute('data-id');
            const dataType = target.getAttribute('data-type');

            const user = auth.currentUser;
            if (!user || user.isAnonymous) {
                showAlert('You must be logged in as an administrator to perform this action.');
                return;
            }

            const password = await showPasswordConfirm(`To delete this ${dataType}, please enter your administrator password:`);

            if (password === null) {
                return;
            }

            if (!password) {
                showAlert('Password is required for deletion.');
                return;
            }

            loadingOverlay.style.display = 'flex';
            loadingMessage.textContent = 'Verifying and deleting...';

            try {
                const credential = EmailAuthProvider.credential(user.email, password);
                await reauthenticateWithCredential(user, credential);

                let collectionName;
                if (dataType === 'student') collectionName = 'students';
                else if (dataType === 'faculty') collectionName = 'faculties';
                else collectionName = `${dataType}s`;
                await deleteDoc(doc(db, collectionName, id));

                // NEW: Also delete all attendance records for this person
                const attendanceCollectionName = `${dataType}_attendance`;
                const attendanceQuery = await getDocs(collection(db, attendanceCollectionName));

                const deletePromises = attendanceQuery.docs.map(async (docSnapshot) => {
                    const data = docSnapshot.data();
                    if (data.records && data.records[id]) {
                        const docRef = doc(db, attendanceCollectionName, docSnapshot.id);
                        return updateDoc(docRef, {
                            [`records.${id}`]: deleteField()
                        });
                    }
                });

                await Promise.all(deletePromises);

                showAlert(`${dataType} and their attendance history deleted successfully.`);

            } catch (error) {
                if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    showAlert('Incorrect password. Deletion cancelled.');
                } else {
                    showAlert(`An error occurred: ${error.message}`);
                }
                console.error("Re-authentication or deletion error:", error);
            } finally {
                loadingOverlay.style.display = 'none';
            }
        } else if (target.classList.contains('edit-btn')) {
            editingId = target.getAttribute('data-id');
            editingType = target.getAttribute('data-type');
            updateSubContent(`add-${editingType}`);
        } else if (target.classList.contains('delete-attendance-btn')) {
            const date = target.dataset.date;
            const personId = target.dataset.personid;
            const type = target.dataset.type;

            const confirmDelete = await showConfirm('Are you sure you want to delete this attendance record?');
            if (!confirmDelete) return;

            const attendanceCollectionName = `${type}_attendance`;
            const docRef = doc(db, attendanceCollectionName, date);

            try {
                await updateDoc(docRef, {
                    [`records.${personId}`]: deleteField()
                });
                showAlert('Attendance record deleted.');
                renderAttendanceSheet(date, type, `${type}-attendance-sheet-container`);
            } catch (error) {
                console.error("Error deleting attendance:", error);
                showAlert('Failed to delete attendance record.');
            }
        } else if (target.classList.contains('edit-attendance-btn')) {
            const date = target.dataset.date;
            const personId = target.dataset.personid;
            const type = target.dataset.type;
            const entryTime = target.dataset.entry === '-' ? '' : target.dataset.entry;
            const exitTime = target.dataset.exit === '-' ? '' : target.dataset.exit;

            currentEditAttendanceParams = { date, personId, type };
            editEntryTimeInput.value = entryTime;
            editExitTimeInput.value = exitTime;
            editAttendanceModal.classList.add('visible');
        }
    });
    // --- Menu Item Click Handling ---
    menuItems.forEach(item => {
        item.addEventListener('click', async () => {
            const contentId = item.getAttribute('data-content-id');
            const publicTabs = ['face-attendance', 'student-attendance', 'faculty-attendance'];
            const isPublicTab = publicTabs.includes(contentId);

            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            if (isPublicTab) {
                // If the user is not logged in at all, sign in anonymously to allow data fetching
                if (!auth.currentUser) {
                    try {
                        await signInAnonymously(auth);
                    } catch (error) {
                        console.error("Anonymous login failed", error);
                        showAlert("Error: Could not sign in anonymously to view this content.");
                        return;
                    }
                }

                // If a user is already logged in as an admin, we DON'T sign them out anymore 
                // when checking public tabs, to avoid annoyance. 
                // Admin can view public tabs too.

                updateMainContent(contentId);
            } else {
                // For any other tab (Administrator, Analytics), always check for ADMIN login.
                if (auth.currentUser && !auth.currentUser.isAnonymous) {
                    // Already an admin
                    updateMainContent(contentId);
                } else {
                    // Not an admin (anonymous or null) -> Show Login
                    renderLogin(contentId);
                }
            }
        });
    });

    // The initial rendering logic is now handled by the onAuthStateChanged listener to prevent race conditions.

});
