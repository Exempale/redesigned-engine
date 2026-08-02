// community-settings.js
let currentCommunityId = null;
let currentCommunityData = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Get community ID from URL
const urlParams = new URLSearchParams(window.location.search);
currentCommunityId = urlParams.get('id');

if (!currentCommunityId) {
    window.location.href = '/';
}

async function loadCommunitySettings() {
    try {
        const response = await fetch(`/api/community/${currentCommunityId}/settings`, {
            credentials: 'same-origin'
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить настройки порта');
        currentCommunityData = data;
        
        // General tab
        document.getElementById('community-name').value = data.username || '';
        document.getElementById('community-status').value = data.status || '';
        document.getElementById('community-description').value = data.description || '';
        document.getElementById('community-rules').value = data.rules || '';
        
        // Profile picture preview
        const pfpPreview = document.getElementById('settings-preview-pfp');
        if (data.profile_picture) pfpPreview.src = data.profile_picture;
        
        // Background preview
        const bgPreview = document.getElementById('settings-preview-background');
        if (data.profile_background) bgPreview.src = data.profile_background;
        
        // Type radio
        if (data.type === 'page') {
            document.getElementById('type-page').checked = true;
        } else {
            document.getElementById('type-community').checked = true;
        }
        
        // Members tab - moderators
        const modsContainer = document.getElementById('moderators-list');
        modsContainer.innerHTML = '';
        if (data.moderators && data.moderators.length > 0) {
            data.moderators.forEach(mod => {
                const modCard = createUserCard(mod, 'moderator');
                modsContainer.appendChild(modCard);
            });
        } else {
            modsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Нет модераторов</div>';
        }
        
        // Members tab - subscribers
        const subsContainer = document.getElementById('subscribers-list');
        subsContainer.innerHTML = '';
        if (data.subscribers && data.subscribers.length > 0) {
            data.subscribers.forEach(sub => {
                const subCard = createUserCard(sub, 'subscriber');
                subsContainer.appendChild(subCard);
            });
        } else {
            subsContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Нет подписчиков</div>';
        }
        
    } catch (err) {
        console.error('Error loading community settings:', err);
    }
}

function createUserCard(user, role) {
    const card = document.createElement('div');
    card.classList.add('friend-card');
    card.setAttribute('data-user-id', user.id);
    card.style.position= 'relative'
    
    const displayRole = window.FortPortRoles?.resolveRole(user);
    const displayRoleClass = displayRole ? ` role-name role-name-${displayRole}` : '';
    const badge = window.FortPortRoles?.badgeHtml(user, { compact: true }) || '';

    card.innerHTML = `
        <img src="${escapeHtml(user.profile_picture || '/default-avatar.jpg')}" class="friend-card-avatar frutiger-aero-border" alt="">
        <div class="friend-card-info">
            <div class="friend-card-name-row">
                <a href="/profile?id=${encodeURIComponent(user.id)}" class="friend-card-name${displayRoleClass}">${escapeHtml(user.username)}</a>
                ${badge}
            </div>
            <span class="friend-card-status">${role === 'moderator' ? 'Модератор порта' : 'Подписчик'}</span>
        </div>
        <div style="display: flex; gap: 8px;">
            ${role !== 'moderator' ? `<button class="promote-btn" style="position:absolute; right:5px; bottom:5px;" onclick="promoteToModerator(${user.id})">Назначить модератором</button>` : ''}
            <button class="friend-card-btn remove-btn" style="position:absolute; right:5px; top:5px;" onclick="removeFromCommunity(${user.id})">Удалить</button>
        </div>
    `;
    
    return card;
}

async function saveCommunitySettings() {
    const formData = new FormData();
    
    formData.append('name', document.getElementById('community-name').value);
    formData.append('status', document.getElementById('community-status').value);
    formData.append('description', document.getElementById('community-description').value);
    formData.append('rules', document.getElementById('community-rules').value);
    
    const typeRadio = document.querySelector('input[name="community-type"]:checked');
    if (typeRadio) formData.append('type', typeRadio.value);
    
    const pfpFile = document.getElementById('pfp-file-select').files[0];
    if (pfpFile) formData.append('profilePicture', pfpFile);
    
    const bgFile = document.getElementById('profile-background-file-select').files[0];
    if (bgFile) formData.append('profileBackground', bgFile);
    
    try {
        const response = await fetch(`/api/community/${currentCommunityId}/update`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Настройки сохранены!');
            if (data.profilePicture) {
                document.getElementById('settings-preview-pfp').src = data.profilePicture;
            }
            if (data.profileBackground) {
                document.getElementById('settings-preview-background').src = data.profileBackground;
            }
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось сохранить'));
        }
    } catch (err) {
        console.error('Save error:', err);
        alert('Ошибка сервера');
    }
}

async function deleteCommunity() {
    if (!confirm('Вы уверены? Это действие нельзя отменить. Весь контент порта будет удалён.')) return;
    
    try {
        const response = await fetch(`/api/community/${currentCommunityId}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Порт удалён');
            window.location.href = '/';
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось удалить'));
        }
    } catch (err) {
        console.error('Delete error:', err);
        alert('Ошибка сервера');
    }
}

async function promoteToModerator(userId) {
    try {
        const response = await fetch(`/api/community/${currentCommunityId}/promote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Пользователь назначен модератором');
            loadCommunitySettings();
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось назначить'));
        }
    } catch (err) {
        console.error('Promote error:', err);
        alert('Ошибка сервера');
    }
}

async function removeFromCommunity(userId) {
    if (!confirm('Удалить пользователя из порта?')) return;
    
    try {
        const response = await fetch(`/api/community/${currentCommunityId}/remove-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Пользователь удалён');
            loadCommunitySettings();
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось удалить'));
        }
    } catch (err) {
        console.error('Remove error:', err);
        alert('Ошибка сервера');
    }
}

function selectType(type) {
    document.getElementById(`type-${type}`).checked = true;
}

function switchSettingsTab(evt, tab) {
    const tabcontents = document.getElementsByClassName("settings-container");
    for (let i = 0; i < tabcontents.length; i++) {
        tabcontents[i].style.display = "none";
    }
    
    const tablinks = document.getElementsByClassName("tab-btn");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    
    document.getElementById(tab).style.display = "flex";
    evt.currentTarget.className += " active";
    
    if (tab === 'members') {
        loadCommunitySettings();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    if (window.FortPortRoles) {
        loadCommunitySettings();
    } else {
        window.addEventListener('fortport:roles-ready', loadCommunitySettings, { once: true });
    }
    
    // Profile picture click handler
    document.getElementById('community-pfp').addEventListener('click', () => {
        document.getElementById('pfp-file-select').click();
    });
    
    document.getElementById('pfp-file-select').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const preview = document.getElementById('settings-preview-pfp');
            preview.src = URL.createObjectURL(file);
        }
    });
    
    // Background click handler
    document.getElementById('settings-preview-background').addEventListener('click', () => {
        document.getElementById('profile-background-file-select').click();
    });
    
    document.getElementById('profile-background-file-select').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const preview = document.getElementById('settings-preview-background');
            preview.src = URL.createObjectURL(file);
        }
    });
    
    // Delete button
    document.getElementById('delete-community-btn').addEventListener('click', deleteCommunity);
});

// Make functions global
window.switchSettingsTab = switchSettingsTab;
window.saveCommunitySettings = saveCommunitySettings;
window.promoteToModerator = promoteToModerator;
window.removeFromCommunity = removeFromCommunity;
window.selectType = selectType;