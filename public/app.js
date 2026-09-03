const socket = io();

let currentUser = null;
let currentFriendId = null;
let currentFriendData = null;
let peerConnection = null;
let localStream = null;
let callTimerInterval = null;
let isMuted = false;
let selectedFile = null;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 ميجابايت
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'txt', 'zip', 'rar'];

const getAvatar = (name, pic) => pic ? pic : `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5288c1&color=fff&size=128`;

async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            showApp();
        } else {
            localStorage.removeItem('token');
        }
    } catch (err) {
        console.error('خطأ في التحقق من الجلسة', err);
    }
}

function showApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('current-user-name').textContent = currentUser.username;
    document.getElementById('current-user-pic').src = getAvatar(currentUser.username, currentUser.profile_pic);
    document.getElementById('temp-email-display').textContent = currentUser.temp_email;
    document.getElementById('catchmail-email').textContent = currentUser.temp_email;
    document.getElementById('profile-username-display').textContent = currentUser.username;
    socket.emit('join_chat', currentUser.id);
    loadFriends();
}

function toggleAuth() {
    const loginBox = document.getElementById('login-box');
    const regBox = document.getElementById('register-box');
    if (loginBox.style.display === 'none') {
        loginBox.style.display = 'block';
        regBox.style.display = 'none';
    } else {
        loginBox.style.display = 'none';
        regBox.style.display = 'block';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        currentUser = data.user;
        localStorage.setItem('token', data.token);
        showApp();
        showToast('تم تسجيل الدخول بنجاح', 'success');
    } catch (err) { showToast('حدث خطأ في الاتصال', 'error'); }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!username || !password) { showToast('يرجى ملء جميع الحقول', 'warning'); return; }
    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast(`تم التسجيل بنجاح!\nبريدك المؤقت: ${data.tempEmail}`, 'success');
        toggleAuth();
    } catch (err) { showToast('حدث خطأ في الاتصال', 'error'); }
}

async function loadFriends() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } });
        const friends = await res.json();
        const list = document.getElementById('friends-list');
        list.innerHTML = '';
        if (friends.length === 0) {
            list.innerHTML = `
                <div style="padding:30px; text-align:center; color:var(--text-secondary);">
                    <i class="fas fa-users" style="font-size:3rem; margin-bottom:15px; opacity:0.3;"></i>
                    <p>لا يوجد أصدقاء بعد</p>
                    <button class="btn-secondary" onclick="openAddFriend()" style="margin-top:15px;">
                        <i class="fas fa-user-plus"></i> إضافة صديق
                    </button>
                </div>`;
            return;
        }
        friends.forEach(f => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            div.innerHTML = `
                <div class="friend-avatar">
                    <img src="${getAvatar(f.username, f.profile_pic)}" alt="">
                    <span class="status-indicator online"></span>
                </div>
                <div class="friend-info">
                    <div class="friend-name">${f.username}</div>
                    <div class="friend-last-message">اضغط لبدء المحادثة</div>
                </div>`;
            div.onclick = () => openChat(f, div);
            list.appendChild(div);
        });
    } catch (err) { showToast('فشل تحميل قائمة الأصدقاء', 'error'); }
}

function openChat(friend, element) {
    currentFriendId = friend.id;
    currentFriendData = friend;
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-input').style.display = 'block';
    document.getElementById('chat-friend-name').textContent = friend.username;
    document.getElementById('chat-friend-pic').src = getAvatar(friend.username, friend.profile_pic);
    loadMessages();
}

async function loadMessages() {
    if (!currentFriendId) return;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`/api/messages/${currentFriendId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const messages = await res.json();
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        messages.forEach(msg => appendMessage(msg));
        scrollToBottom();
    } catch (err) { showToast('فشل تحميل الرسائل', 'error'); }
}

function appendMessage(msg) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    div.className = `message ${msg.sender_id === currentUser.id ? 'out' : 'in'}`;
    let contentHtml = '';
    if (msg.file_url) {
        if (msg.file_type && msg.file_type.startsWith('image/')) {
            contentHtml += `<a href="${msg.file_url}" target="_blank" class="file-attachment"><img src="${msg.file_url}" alt="صورة"></a>`;
        } else {
            contentHtml += `<a href="${msg.file_url}" target="_blank" class="file-attachment"><i class="fas fa-file-alt"></i><span>${msg.content || 'ملف مرفق'}</span></a>`;
        }
    }
    if (msg.content && !msg.file_url) {
        contentHtml += `<div class="message-content">${escapeHtml(msg.content)}</div>`;
    }
    const time = new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `${contentHtml}<div class="message-time">${time} <i class="fas fa-check"></i></div>`;
    container.appendChild(div);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if ((!content || !currentFriendId) && !selectedFile) return;
    if (selectedFile) {
        uploadAndSendFile(selectedFile, content);
        selectedFile = null;
        clearFileInput();
    } else {
        const data = { sender_id: currentUser.id, receiver_id: currentFriendId, content, type: 'text' };
        socket.emit('send_message', data);
        appendMessage({ ...data, timestamp: new Date() });
    }
    input.value = '';
    input.focus();
}

function clearFile() {
    selectedFile = null;
    clearFileInput();
}

function clearFileInput() {
    document.getElementById('file-upload').value = '';
    document.getElementById('file-info').style.display = 'none';
}

async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
        showToast(`حجم الملف كبير جداً. الحد الأقصى هو ${MAX_FILE_SIZE/1024/1024} ميجابايت`, 'error');
        input.value = ''; return;
    }
    const extension = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        showToast(`نوع الملف غير مسموح. الأنواع المسموحة: ${ALLOWED_EXTENSIONS.join(', ')}`, 'error');
        input.value = ''; return;
    }
    selectedFile = file;
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-info').style.display = 'flex';
    showToast('تم إرفاق الملف. اضغط إرسال', 'success');
}

async function uploadAndSendFile(file, content = '') {
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('token');
    try {
        showToast('جاري رفع الملف...', 'warning');
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        const msgData = { sender_id: currentUser.id, receiver_id: currentFriendId, content: content || file.name, file_url: data.url, file_type: data.type };
        socket.emit('send_message', msgData);
        appendMessage({ ...msgData, timestamp: new Date() });
        showToast('تم إرسال الملف بنجاح', 'success');
        clearFile();
    } catch (err) { showToast('فشل رفع الملف', 'error'); }
}

socket.on('receive_message', (msg) => {
    if (msg.sender_id === currentFriendId) {
        appendMessage(msg);
        scrollToBottom();
        playNotificationSound();
    } else {
        showToast('رسالة جديدة', 'info');
    }
});

function playNotificationSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRnoAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
    audio.play().catch(() => {});
}

function openProfile() {
    document.getElementById('profile-modal').classList.add('active');
    document.getElementById('bg-preview').style.backgroundImage = currentUser.bg_pic ? `url(${currentUser.bg_pic})` : 'none';
    document.getElementById('profile-pic-preview').src = getAvatar(currentUser.username, currentUser.profile_pic);
    document.getElementById('new-bio').value = currentUser.bio || '';
}

async function updateProfile() {
    const formData = new FormData();
    const bio = document.getElementById('new-bio').value;
    const profilePic = document.getElementById('new-profile-pic').files[0];
    const bgPic = document.getElementById('new-bg-pic').files[0];
    formData.append('bio', bio);
    if (profilePic) formData.append('profile_pic', profilePic);
    if (bgPic) formData.append('bg_pic', bgPic);
    const token = localStorage.getItem('token');
    try {
        showToast('جاري الحفظ...', 'warning');
        const res = await fetch('/api/profile/update', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('تم تحديث الملف الشخصي بنجاح', 'success');
        setTimeout(() => { closeModal('profile-modal'); location.reload(); }, 1000);
    } catch (err) { showToast('فشل حفظ التغييرات', 'error'); }
}

async function checkCatchmail() {
    const token = localStorage.getItem('token');
    const container = document.getElementById('catchmail-messages');
    container.innerHTML = '<p style="text-align:center; padding:15px;"><i class="fas fa-spinner fa-spin"></i> جاري الفحص...</p>';
    try {
        const res = await fetch('/api/catchmail', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        container.innerHTML = '';
        if (!data || data.length === 0) {
            container.innerHTML = `<div style="text-align:center; color:var(--text-secondary); padding:20px;"><i class="fas fa-inbox" style="font-size:2rem; margin-bottom:10px; opacity:0.3;"></i><p>لا توجد رسائل جديدة</p></div>`;
        } else {
            data.forEach(msg => {
                container.innerHTML += `
                    <div style="background:var(--bg-dark); padding:15px; margin:8px 0; border-radius:8px; border-right:3px solid var(--primary-color);">
                        <div style="font-weight:600; margin-bottom:5px; color:var(--primary-light);">${msg.from || 'مجهول'}</div>
                        <div style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:5px;">${msg.subject || 'بدون عنوان'}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">${new Date(msg.date || Date.now()).toLocaleString('ar-EG')}</div>
                    </div>`;
            });
        }
    } catch (err) {
        container.innerHTML = '<p style="color:var(--danger-color); text-align:center;">فشل جلب الرسائل</p>';
    }
}

function openAddFriend() {
    document.getElementById('add-friend-modal').classList.add('active');
    document.getElementById('friend-identifier').focus();
}

async function handleAddFriend(e) {
    e.preventDefault();
    const identifier = document.getElementById('friend-identifier').value.trim();
    if (!identifier) { showToast('يرجى إدخال اسم المستخدم أو البريد', 'warning'); return; }
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/friends/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ friendIdentifier: identifier })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('تمت إضافة الصديق بنجاح', 'success');
        document.getElementById('friend-identifier').value = '';
        closeModal('add-friend-modal');
        loadFriends();
    } catch (err) { showToast('حدث خطأ في الإضافة', 'error'); }
}

async function startVoiceCall() {
    if (!currentFriendId) { showToast('الرجاء اختيار صديق أولاً', 'warning'); return; }
    document.getElementById('call-modal').classList.add('active');
    document.getElementById('call-name').textContent = currentFriendData.username;
    document.getElementById('call-avatar').src = getAvatar(currentFriendData.username, currentFriendData.profile_pic);
    document.getElementById('call-status').textContent = 'جاري الاتصال...';
    document.getElementById('call-timer').style.display = 'none';
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        peerConnection.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play().catch(e => console.log('تشغيل الصوت:', e));
            document.getElementById('call-status').textContent = 'متصل';
            startCallTimer();
        };
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_ice_candidate', { sender_id: currentUser.id, receiver_id: currentFriendId, candidate: event.candidate });
            }
        };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc_offer', { sender_id: currentUser.id, receiver_id: currentFriendId, offer });
    } catch (err) {
        showToast('لا يمكن الوصول إلى الميكروفون. يرجى السماح بالأذونات.', 'error');
        endCall();
    }
}

socket.on('webrtc_offer', async (data) => {
    if (data.receiver_id === currentUser.id) {
        showToast('مكالمة واردة...', 'info');
        document.getElementById('call-modal').classList.add('active');
        document.getElementById('call-name').textContent = 'مكالمة واردة';
        document.getElementById('call-status').textContent = 'يرن...';
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            peerConnection.ontrack = (event) => {
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.play();
                document.getElementById('call-status').textContent = 'متصل 🔊';
                startCallTimer();
            };
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('webrtc_ice_candidate', { sender_id: currentUser.id, receiver_id: data.sender_id, candidate: event.candidate });
                }
            };
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('webrtc_answer', { sender_id: currentUser.id, receiver_id: data.sender_id, answer });
        } catch (err) {
            showToast('خطأ في قبول المكالمة', 'error');
            endCall();
        }
    }
});

socket.on('webrtc_answer', async (data) => {
    if (data.receiver_id === currentUser.id && peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
});

socket.on('webrtc_ice_candidate', async (data) => {
    if (data.receiver_id === currentUser.id && peerConnection) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { console.error('خطأ في إضافة ICE Candidate', e); }
    }
});

socket.on('call_ended', () => { showToast('انتهت المكالمة', 'info'); endCall(); });

function startCallTimer() {
    let seconds = 0;
    callTimerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        document.querySelector('#call-timer span').textContent = `${mins}:${secs}`;
    }, 1000);
    document.getElementById('call-timer').style.display = 'flex';
}

function endCall() {
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    if (currentFriendId) { socket.emit('end_call_signal', { sender_id: currentUser.id, receiver_id: currentFriendId }); }
    document.getElementById('call-modal').classList.remove('active');
}

function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isMuted = !isMuted;
            audioTrack.enabled = !isMuted;
            showToast(isMuted ? 'تم كتم الصوت' : 'تم تفعيل الصوت', 'info');
        }
    }
}

function toggleSpeaker() { showToast('تبديل السماعة', 'info'); }

function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function logout() { localStorage.removeItem('token'); location.reload(); }

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.closest('.tab-btn').classList.add('active');
}

window.onclick = function (event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.parentElement.classList.remove('active');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
    }
    checkAuth();
});
