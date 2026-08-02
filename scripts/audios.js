// audios.js

// ============================================
// STATE
// ============================================

let viewedUserId = null;

const state = {
    currentTab: 'library',
    audios: [],
    playlists: [],
    currentAudio: null,
    currentPlaylist: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffled: false,
    isRepeating: false,
    audioElement: null,
    queue: [],
    queueIndex: -1
};

// ============================================
// DOM REFS
// ============================================

const dom = {
    libraryList: document.getElementById('library-list'),
    playlistsList: document.getElementById('playlists-list'),
    libraryView: document.getElementById('library-view'),
    playlistsView: document.getElementById('playlists-view'),
    tabs: document.querySelectorAll('.audios-tab'),
    songName: document.getElementById('current-song-name'),
    songArtist: document.getElementById('current-song-artist'),
    playBtn: document.getElementById('play-btn'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    shuffleBtn: document.getElementById('shuffle-btn'),
    repeatBtn: document.getElementById('repeat-btn'),
    volumeBtn: document.getElementById('volume-btn'),
    volumeSlider: document.getElementById('volume-slider'),
    progressSlider: document.getElementById('progress-slider'),
    currentTime: document.getElementById('current-time'),
    totalTime: document.getElementById('total-time'),
    uploadBtn: document.getElementById('upload-audio-btn'),
    fileInput: document.getElementById('audio-file-input'),
};

// ============================================
// AUDIO PLAYER
// ============================================

function initPlayer() {
    state.audioElement = new Audio();
    state.audioElement.volume = parseFloat(localStorage.getItem('audioVolume')) || 0.8;
    dom.volumeSlider.value = state.audioElement.volume;
dom.progressSlider.style.backgroundSize = '0% 100%';

    // Load volume from settings
    const savedVolume = localStorage.getItem('audioVolume');
    if (savedVolume !== null) {
        state.audioElement.volume = parseFloat(savedVolume);
        dom.volumeSlider.value = state.audioElement.volume;
    }

    // Event listeners
state.audioElement.addEventListener('timeupdate', updateProgress);  // ✅
state.audioElement.addEventListener('loadedmetadata', updateTotalTime);  // ✅
state.audioElement.addEventListener('ended', onSongEnd);  // ✅
state.audioElement.addEventListener('play', () => {
    state.isPlaying = true;
    document.getElementById('play-icon').src = '/ui/icons/pause.webp';
    document.getElementById('audios-bg-disc').classList.add('spinning');
});
state.audioElement.addEventListener('pause', () => {
    state.isPlaying = false;
    document.getElementById('play-icon').src = '/ui/icons/play.webp';
    document.getElementById('audios-bg-disc').classList.remove('spinning');
});

    // Controls
    dom.playBtn.addEventListener('click', togglePlay);
    dom.prevBtn.addEventListener('click', playPrevious);
    dom.nextBtn.addEventListener('click', playNext);
    dom.shuffleBtn.addEventListener('click', toggleShuffle);
    dom.repeatBtn.addEventListener('click', toggleRepeat);
    dom.volumeSlider.addEventListener('input', updateVolume);
    dom.volumeBtn.addEventListener('click', toggleMute);
    dom.progressSlider.addEventListener('input', seekProgress);

    // Upload
    dom.uploadBtn.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', uploadAudio);

    // Tabs
    dom.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

function playSfx(soundFile) {
    if (localStorage.getItem('audiosSFX') !== '1') return;
    
    const volume = parseFloat(dom.volumeSlider.value) || 0;
    if (volume === 0) return;
    
    try {
        const audio = new Audio(`/sounds/${soundFile}`);
        audio.volume = volume;
        audio.play().catch(() => {});
    } catch (e) {
        // Silent fail
    }
}

function togglePlay() {
    if (!state.audioElement.src) {
        if (state.audios.length > 0) {
            playAudio(state.audios[0], 0);
            playSfx('cd_insert.mp3');
        }
        return;
    }

    if (state.isPlaying) {
        state.audioElement.pause();
        document.getElementById('play-icon').src = '/ui/icons/play.webp';
        playSfx('cd_scratch.mp3');
    } else {
        state.audioElement.play();
        document.getElementById('play-icon').src = '/ui/icons/pause.webp';
        playSfx('cd_click.mp3');
    }
}

function playAudio(audio, index) {
    // Stop and unload previous audio
    state.audioElement.pause();
    state.audioElement.src = '';
    state.audioElement.load(); // This forces it to unload
    
    // Check if this is the first song being played
    const isFirst = !state.currentAudio;
    
    state.currentAudio = audio;
    state.currentIndex = index;
    state.audioElement.src = audio.url || audio.file_path;
    state.audioElement.load();
    state.audioElement.play();
    updatePlayerInfo(audio);
    renderLibrary();
    
    if (isFirst) {
        playSfx('cd_insert.mp3');
    } else {
        playSfx('cd_change.mp3');
    }
}

function playNext() {
    const nextIndex = getNextIndex();
    if (nextIndex === -1) return;
    
    let audio;
    if (state.queue.length > 0) {
        audio = state.queue[nextIndex];
        state.queueIndex = nextIndex;
    } else {
        audio = state.audios[nextIndex];
    }
    
    if (audio) {
        playAudio(audio, nextIndex);
        playSfx('cd_click.mp3');
        playSfx('cd_change.mp3');
    }
}

function playPrevious() {
    if (state.audioElement.currentTime > 3) {
        state.audioElement.currentTime = 0;
        return;
    }
    const prevIndex = getPrevIndex();
    if (prevIndex === -1) return;
    
    let audio;
    if (state.queue.length > 0) {
        audio = state.queue[prevIndex];
        state.queueIndex = prevIndex;
    } else {
        audio = state.audios[prevIndex];
    }
    
    if (audio) {
        playAudio(audio, prevIndex);
        playSfx('cd_click.mp3');
        playSfx('cd_change.mp3');
    }
}

function getNextIndex() {
    if (state.queue.length > 0) {
        const next = state.queueIndex + 1;
        if (next < state.queue.length) return next;
        return -1; // No repeat for queue
    }
    const next = state.currentIndex + 1;
    if (next < state.audios.length) return next;
    return -1;
}

function getPrevIndex() {
    if (state.queue.length > 0) {
        const prev = state.queueIndex - 1;
        if (prev >= 0) return prev;
        return -1;
    }
    const prev = state.currentIndex - 1;
    if (prev >= 0) return prev;
    return -1;
}

function onSongEnd() {
if (state.isRepeating) {
        state.audioElement.currentTime = 0;
        state.audioElement.play();
        return;
    }
    playNext();
}

function toggleShuffle() {
    playSfx('cd_click.mp3');
    state.isShuffled = !state.isShuffled;
    dom.shuffleBtn.classList.toggle('active', state.isShuffled);
    
    if (state.isShuffled) {
        // If no audio is playing, shuffle the whole list
        if (!state.currentAudio || state.audios.length === 0) {
            state.queue = [...state.audios];
            // Fisher-Yates shuffle
            for (let i = state.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
            }
            state.queueIndex = -1;
            return;
        }
        
        // Current audio is playing - make it first in queue
        const currentIndex = state.audios.findIndex(a => a.id === state.currentAudio.id);
        if (currentIndex === -1) {
            state.queue = [...state.audios];
            state.queueIndex = -1;
            return;
        }
        
        // Build queue: current song first, then all others shuffled
        const remaining = state.audios.filter((_, i) => i !== currentIndex);
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        
        state.queue = [state.currentAudio, ...remaining];
        state.queueIndex = 0;
        
    } else {
        // Shuffle off - clear queue
        state.queue = [];
        state.queueIndex = -1;
    }
}

function toggleRepeat() {
    state.isRepeating = !state.isRepeating;
    dom.repeatBtn.classList.toggle('active', state.isRepeating);
    playSfx('cd_click.mp3');
}

function updateVolume(e) {
    const vol = parseFloat(e.target.value);
    state.audioElement.volume = vol;
    localStorage.setItem('audioVolume', vol);
}

function toggleMute() {
    if (state.audioElement.volume > 0) {
        state.audioElement.volume = 0;
        dom.volumeSlider.value = 0;
        dom.volumeBtn.classList.add('muted');
        localStorage.setItem('audioVolume', '0');
    } else {
        const vol = 0.8;
        state.audioElement.volume = vol;
        dom.volumeSlider.value = vol;
        dom.volumeBtn.classList.remove('muted');
        localStorage.setItem('audioVolume', vol);
    }
}

function seekProgress(e) {
    if (!state.audioElement.duration) return;
    const percent = parseFloat(e.target.value) / 100;
    state.audioElement.currentTime = percent * state.audioElement.duration;
}

function updateProgress() {
    if (!state.audioElement || !state.audioElement.duration) {
        dom.currentTime.textContent = '0:00';
        return;
    }
    const percent = (state.audioElement.currentTime / state.audioElement.duration) * 100;
    dom.progressSlider.value = percent;
    
    // Update the background fill for WebKit
    dom.progressSlider.style.backgroundSize = percent + '% 100%';
    
    dom.currentTime.textContent = formatTime(state.audioElement.currentTime);
}

function updateTotalTime() {
    if (!state.audioElement || !state.audioElement.duration) {
        dom.totalTime.textContent = '0:00';
        return;
    }
    dom.totalTime.textContent = formatTime(state.audioElement.duration);
}

function updatePlayerInfo(audio) {
    if (!audio) {
        dom.songName.textContent = '—';
        dom.songArtist.textContent = '—';
        dom.currentTime.textContent = '0:00';
        dom.totalTime.textContent = '0:00';
        dom.progressSlider.value = 0;
        return;
    }
    dom.songName.textContent = audio.name || 'Без названия';
    dom.songArtist.textContent = audio.artist_name || 'Неизвестно';
    dom.currentTime.textContent = '0:00';
    dom.totalTime.textContent = '0:00';
    dom.progressSlider.value = 0;
}

function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// API CALLS
// ============================================

async function loadAudios(userId) {
    const targetUserId = userId || viewedUserId || localStorage.getItem('userId');
    if (!targetUserId) return;

    try {
        const res = await fetch(`/api/users/audios?userId=${targetUserId}`, {
            credentials: 'same-origin'
        });
        const data = await res.json();
        state.audios = data.audios || [];
        renderLibrary();
    } catch (err) {
        console.error('Error loading audios:', err);
    }
}

async function loadPlaylists() {
    const userId = localStorage.getItem('userId');
    if (!userId) return;

    try {
        const res = await fetch(`/api/users/audios/playlists?userId=${userId}`, {
            credentials: 'same-origin'
        });
        const data = await res.json();
        state.playlists = data.playlists || [];
        renderPlaylists();
    } catch (err) {
        console.error('Error loading playlists:', err);
    }
}

async function loadUserProfileBackground(userId) {
    if (!userId) return;
    
    try {
        const res = await fetch(`/api/users/bio/${userId}`);
        const userBio = await res.json();
        
        if (userBio.profileBackground) {
            document.body.style.backgroundImage = `url(${userBio.profileBackground})`;
        }
    } catch (err) {
        console.error('Error loading user background:', err);
    }
}

async function uploadAudio(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
        alert('Пожалуйста, выберите аудиофайл');
        return;
    }

    // Only allow upload if viewing own profile
    const currentUserId = parseInt(localStorage.getItem('userId'));
    if (viewedUserId && parseInt(viewedUserId) !== currentUserId) {
        alert('Вы не можете загружать аудио в чужую библиотеку');
        return;
    }

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('name', file.name.replace(/\.[^/.]+$/, ''));
    formData.append('artistName', 'Неизвестно');

    try {
        const res = await fetch('/api/audios', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (data.success) {
            // Add to library at position 1 (top)
            const addRes = await fetch(`/api/users/audios/${data.audio.id}`, {
                method: 'POST',
                credentials: 'same-origin'
            });
            if (addRes.ok) {
                await loadAudios(viewedUserId);
                dom.fileInput.value = '';
            }
        }
    } catch (err) {
        console.error('Error uploading audio:', err);
        alert('Ошибка загрузки аудио');
    }
}

async function addToLibrary(audioId) {
    try {
        const res = await fetch(`/api/users/audios/${audioId}`, {
            method: 'POST',
            credentials: 'same-origin'
        });
        if (res.ok) {
            await loadAudios();
        }
    } catch (err) {
        console.error('Error adding to library:', err);
    }
}

async function removeFromLibrary(audioId) {
    try {
        const res = await fetch(`/api/users/audios/${audioId}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        if (res.ok) {
            await loadAudios();
            if (state.currentAudio && state.currentAudio.id === audioId) {
                state.audioElement.pause();
                state.audioElement.src = '';
                state.currentAudio = null;
                dom.songName.textContent = 'Нет аудио';
                dom.songArtist.textContent = '—';
            }
        }
    } catch (err) {
        console.error('Error removing from library:', err);
    }
}

// ============================================
// RENDER
// ============================================

function renderLibrary() {
    if (state.audios.length === 0) {
        dom.libraryList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><img src="/ui/icons/audios_aero.webp" style="height:72px; width:auto;"></div>
                <div>У вас пока нет аудиозаписей</div>
                <div style="font-size: 13px; margin-top: 8px;">Загрузите свою первую аудиозапись!</div>
            </div>
        `;
        return;
    }

    const currentUserId = parseInt(localStorage.getItem('userId'));
    const viewedId = parseInt(viewedUserId || currentUserId);
    const isOwnProfile = viewedId === currentUserId;
    
    let html = '';
    state.audios.forEach((audio, index) => {
        const isActive = state.currentAudio && state.currentAudio.id === audio.id;
        const isOwner = audio.uploaded_by === currentUserId;
        const isInLibrary = audio.in_library !== undefined ? audio.in_library : isOwnProfile;
        
        html += `
            <div class="audio-item ${isActive ? 'active' : ''}" data-audio-id="${audio.id}" data-index="${index}">
                <span class="audio-index">${index + 1}</span>
                <div class="audio-info" onclick="playAudioById(${audio.id})">
                    <div class="audio-name">${escapeHtml(audio.name || 'Без названия')}</div>
                    <div class="audio-artist">${escapeHtml(audio.artist_name || 'Неизвестно')}</div>
                </div>
                <div class="audio-actions">
                    <button class="download-btn" onclick="downloadAudio(${audio.id})" title="Скачать">⬇</button>
                    ${isOwner && isOwnProfile ? `<button class="edit-btn" onclick="editAudioMetadata(${audio.id})" title="Редактировать">✎</button>` : ''}
                    ${isOwnProfile ? 
                        `<button class="remove-btn" onclick="removeFromLibrary(${audio.id})" title="Удалить из библиотеки">✕</button>` :
                        (isInLibrary ? 
                            `<button class="remove-btn" onclick="removeFromLibrary(${audio.id})" title="Удалить из библиотеки">✕</button>` :
                            `<button class="add-btn" onclick="addToLibrary(${audio.id})" title="Добавить в библиотеку">+</button>`
                        )
                    }
                </div>
            </div>
        `;
    });
    dom.libraryList.innerHTML = html;
}

function renderLibraryWithState(userLibraryIds) {
    const currentUserId = parseInt(localStorage.getItem('userId'));
    const viewedId = parseInt(viewedUserId || currentUserId);
    const isOwnProfile = viewedId === currentUserId;
    
    let html = '';
    state.audios.forEach((audio, index) => {
        const isActive = state.currentAudio && state.currentAudio.id === audio.id;
        const isOwner = audio.uploaded_by === currentUserId;
        const isInLibrary = userLibraryIds.has(audio.id);
        
        html += `
            <div class="audio-item ${isActive ? 'active' : ''}" data-audio-id="${audio.id}" data-index="${index}">
                <span class="audio-index">${index + 1}</span>
                <div class="audio-info" onclick="playAudioById(${audio.id})">
                    <div class="audio-name">${escapeHtml(audio.name || 'Без названия')}</div>
                    <div class="audio-artist">${escapeHtml(audio.artist_name || 'Неизвестно')}</div>
                </div>
                <div class="audio-actions">
                    <button class="download-btn" onclick="downloadAudio(${audio.id})" title="Скачать">⬇</button>
                    ${isOwner && isOwnProfile ? `<button class="edit-btn" onclick="editAudioMetadata(${audio.id})" title="Редактировать">✎</button>` : ''}
                    ${isOwnProfile ? 
                        `<button class="remove-btn" onclick="removeFromLibrary(${audio.id})" title="Удалить из библиотеки">✕</button>` :
                        (isInLibrary ? 
                            `<button class="remove-btn" onclick="removeFromLibrary(${audio.id})" title="Удалить из библиотеки">✕</button>` :
                            `<button class="add-btn" onclick="addToLibrary(${audio.id})" title="Добавить в библиотеку">+</button>`
                        )
                    }
                </div>
            </div>
        `;
    });
    dom.libraryList.innerHTML = html;
}

async function addToLibrary(audioId) {
    try {
        const res = await fetch(`/api/users/audios/${audioId}`, {
            method: 'POST',
            credentials: 'same-origin'
        });
        if (res.ok) {
            await loadAudios(viewedUserId || localStorage.getItem('userId'));
        }
    } catch (err) {
        console.error('Error adding to library:', err);
    }
}

function downloadAudio(audioId) {
    const audio = state.audios.find(a => a.id === audioId);
    if (!audio) return;
    
    // Use the file_path or url
    const filePath = audio.url || audio.file_path;
    if (!filePath) return;
    
    // Create a temporary anchor element
    const link = document.createElement('a');
    link.href = filePath;
    link.download = (audio.name || 'audio') + '.mp3';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function editAudioMetadata(audioId) {
    const audio = state.audios.find(a => a.id === audioId);
    if (!audio) return;
    
    const userId = parseInt(localStorage.getItem('userId'));
    if (audio.uploaded_by !== userId) {
        alert('Вы можете редактировать только свои аудиозаписи');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Редактировать аудио</h3>
            <label>Название</label>
            <input type="text" id="edit-audio-name" value="${escapeHtml(audio.name || '')}">
            <label>Исполнитель</label>
            <input type="text" id="edit-audio-artist" value="${escapeHtml(audio.artist_name || '')}">
            <label>Жанр</label>
            <input type="text" id="edit-audio-genre" value="${escapeHtml(audio.genre || '')}">
            <div class="modal-buttons">
                <button class="cancel-btn" onclick="this.closest('.modal-overlay').remove()">Отмена</button>
                <button class="save-btn" onclick="saveAudioMetadata(${audioId})">Сохранить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

async function saveAudioMetadata(audioId) {
    const modal = document.querySelector('.modal-overlay');
    const name = document.getElementById('edit-audio-name').value.trim();
    const artistName = document.getElementById('edit-audio-artist').value.trim();
    const genre = document.getElementById('edit-audio-genre').value.trim();
    
    if (!name) {
        alert('Название не может быть пустым');
        return;
    }
    
    try {
        const res = await fetch(`/api/audios/${audioId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, artistName, genre }),
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (data.success) {
            if (modal) modal.remove();
            await loadAudios();
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось обновить'));
        }
    } catch (err) {
        console.error('Error updating audio:', err);
        alert('Ошибка сервера');
    }
}

function renderPlaylists() {
    if (state.playlists.length === 0) {
        dom.playlistsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <div>У вас пока нет плейлистов</div>
                <div style="font-size: 13px; margin-top: 8px;">Создайте свой первый плейлист!</div>
            </div>
        `;
        return;
    }

    let html = '';
    state.playlists.forEach(playlist => {
        html += `
            <div class="playlist-item" onclick="openPlaylist(${playlist.id})">
                <div class="playlist-info">
                    <div class="playlist-name">${escapeHtml(playlist.name)}</div>
                    <div class="playlist-count">${playlist.audio_count || 0} треков</div>
                </div>
                <div class="playlist-actions">
                    <button class="delete-btn" onclick="deletePlaylist(${playlist.id})" title="Удалить">🗑</button>
                </div>
            </div>
        `;
    });
    dom.playlistsList.innerHTML = html;
}

// ============================================
// PLAYBACK CONTROL
// ============================================

function playAudioById(audioId) {
    const audio = state.audios.find(a => a.id === audioId);
    if (!audio) return;
    
    if (state.currentAudio && state.currentAudio.id === audioId && state.isPlaying) {
        state.audioElement.pause();
        playSfx('cd_scratch.mp3');
        return;
    }
    
    if (state.currentAudio && state.currentAudio.id === audioId && !state.isPlaying) {
        state.audioElement.play();
        playSfx('cd_click.mp3');
        return;
    }
    
    playAudio(audio, state.audios.indexOf(audio));
    playSfx('cd_change.mp3');
}

// ============================================
// TAB SWITCHING
// ============================================

function switchTab(tab) {
    state.currentTab = tab;
    dom.tabs.forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    if (tab === 'library') {
        dom.libraryView.style.display = 'block';
        dom.playlistsView.style.display = 'none';
    } else {
        dom.libraryView.style.display = 'none';
        dom.playlistsView.style.display = 'block';
        loadPlaylists();
    }
}

// ============================================
// HELPERS
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}



// ============================================
// INIT
// ============================================

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('id');
    const currentUserId = localStorage.getItem('userId');
    
    // If no userId in URL, default to current user
    if (!userId && currentUserId) {
        userId = currentUserId;
        // Update URL to include it
        const url = new URL(window.location);
        url.searchParams.set('id', userId);
        window.history.replaceState({}, '', url);
    }
    
    if (userId) {
        viewedUserId = userId;
    }
    
    // Load user profile background
    await loadUserProfileBackground(userId || currentUserId);
    
    initPlayer();
    await loadAudios(viewedUserId);
    updatePlayerInfo(null);
}

async function getUserInfo(userId) {
    try {
        const res = await fetch(`/api/users/${userId}`, {
            credentials: 'same-origin'
        });
        return await res.json();
    } catch (err) {
        console.error('Error fetching user:', err);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const sfxToggle = document.getElementById('audios-sfx-toggle');
    if (sfxToggle) {
	 sfxToggle.checked = localStorage.getItem('audiosSFX') === '1';
        sfxToggle.addEventListener('change', (e) => {
            localStorage.setItem('audiosSFX', e.target.checked ? '1' : '0');
        });
    }
});

document.addEventListener('DOMContentLoaded', init);

// Make functions global for inline onclick
window.editAudioMetadata = editAudioMetadata;
window.saveAudioMetadata = saveAudioMetadata;
window.playAudioById = playAudioById;
window.addToLibrary = addToLibrary;
window.removeFromLibrary = removeFromLibrary;
window.openPlaylist = (id) => console.log('Open playlist:', id);
window.deletePlaylist = (id) => console.log('Delete playlist:', id);
window.switchTab = switchTab;