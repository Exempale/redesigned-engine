const currentURL = window.location.href;

async function loadUserSettings() {
    const userId = localStorage.getItem('userId');
    const custBg = localStorage.getItem('customBg');
    const body = document.body;
    if (custBg && custBg !== 'null') {
        body.style.backgroundImage = `url('${custBg}')`;
    }
}

// ============ SETTINGS PAGE ============
if (window.location.pathname === '/settings') {
    const userId = localStorage.getItem('userId');

    async function switchSettingsTab(evt, tab) {
        const tabcontent = document.getElementsByClassName('settings-container');
        for (let i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = 'none';
        }

        const tablinks = document.getElementsByClassName('tab-btn');
        for (let i = 0; i < tablinks.length; i++) {
            tablinks[i].className = tablinks[i].className.replace(' active', '');
        }

        document.getElementById(tab).style.display = 'flex';
        evt.currentTarget.className += ' active';
    }

    async function loadSettings() {
        const pfpFileHandler = document.getElementById('pfp-file-select');
        const backgroundFileHandler = document.getElementById('profile-background-file-select');
        const siteBg = document.getElementById('site-bg-select');

        // Load Bio
        const userBioResponse = await fetch(`/api/users/bio/${userId}`);
        const userBio = await userBioResponse.json();

        document.getElementById('settings-username').value = userBio.username || '';
        document.getElementById('settings-status').value = userBio.status || '';
        document.getElementById('settings-preview-pfp').src = userBio.profilePicture || '/default-avatar.jpg';
        document.getElementById('settings-preview-background').src = userBio.profileBackground || '/bg.webp';
        document.getElementById('settings-description').value = userBio.description || '';
        document.getElementById('settings-birthday').value = userBio.dateOfBirth || '';
        document.getElementById('settings-homecountry').value = userBio.homeCountry || '';
        document.getElementById('settings-education').value = userBio.education || '';
        document.getElementById('settings-job').value = userBio.workplace || '';
        document.getElementById('settings-hobbies').value = userBio.hobbies || '';
        document.getElementById('settings-fandoms').value = userBio.fandoms || '';
        document.getElementById('settings-religion').value = userBio.religion || '';

        // Load Privacy
        const userSeqResponse = await fetch(`/api/users/seq/${userId}`, { credentials: 'same-origin' });
        const userSeq = await userSeqResponse.json();

        const showFeed = document.getElementById('show-posts-feed');
        const anonProfile = document.getElementById('anonymus-profile');
        showFeed.checked = userSeq.showPostsFeed === 0;
        anonProfile.checked = userSeq.anonymousPage === 1;

        document.getElementById('who-posts').value = userSeq.showPostsProfile || 0;
        document.getElementById('who-info').value = userSeq.showInfoProfile || 0;
        document.getElementById('who-friends').value = userSeq.showFriendsList || 0;
        document.getElementById('who-communities').value = userSeq.showCommunitiesList || 0;
        document.getElementById('who-music').value = userSeq.showAudios || 0;
        document.getElementById('who-chat').value = userSeq.allowMessagesFrom || 0;

        // Load Customization
        const userCustResponse = await fetch(`/api/users/cust/${userId}`, { credentials: 'same-origin' });
        const userCust = await userCustResponse.json();

        if (userCust.customBackground) {
            document.getElementById('site-bg-preview').src = userCust.customBackground;
        }
        document.getElementById('notifications-check').checked = userCust.notificationSound === 1;
        document.getElementById('chat-check').checked = userCust.chatMessageSound === 1;
        document.getElementById('new-post-check').checked = userCust.postSentSound === 1;
        document.getElementById('online-check').checked = userCust.friendOnlineSound === 1;
        document.getElementById('friend-request-check').checked = userCust.friendRequestSound === 1;

        // Load Mascot settings
        const mascotToggle = document.getElementById('mascot-toggle');
        const handholdingToggle = document.getElementById('handholding-toggle');
        const bricked = localStorage.getItem('mascotBricked');
        const handHolding = localStorage.getItem('handHolding');

        if (mascotToggle) {
            mascotToggle.checked = false;
            mascotToggle.disabled = true;
            mascotToggle.title = 'Жека включён для всех пользователей';
        }
        if (handHolding !== null) {
            handholdingToggle.checked = handHolding === '1';
        }

        // Event listeners for file uploads
        document.getElementById('settings-pfp').addEventListener('click', () => pfpFileHandler.click());
        document.getElementById('settings-preview-background').addEventListener('click', () => backgroundFileHandler.click());
        document.getElementById('site-bg-preview').addEventListener('click', () => siteBg.click());

        pfpFileHandler.addEventListener('change', function (event) {
            const file = event.target.files[0];
            if (file) {
                document.getElementById('settings-preview-pfp').src = URL.createObjectURL(file);
            }
        });

        backgroundFileHandler.addEventListener('change', function (event) {
            const file = event.target.files[0];
            if (file) {
                document.getElementById('settings-preview-background').src = URL.createObjectURL(file);
            }
        });

        siteBg.addEventListener('change', function (event) {
            const file = event.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                document.getElementById('site-bg-preview').src = url;
                document.body.style.backgroundImage = `url('${url}')`;
            }
        });
    }

    async function saveSettingsBio() {
        const formData = new FormData();
        formData.append('username', document.getElementById('settings-username').value);
        formData.append('description', document.getElementById('settings-description').value);
        formData.append('status', document.getElementById('settings-status').value);
        formData.append('profilePicture', document.getElementById('pfp-file-select').files[0] || '');
        formData.append('profileBackground', document.getElementById('profile-background-file-select').files[0] || '');
        formData.append('date_of_birth', document.getElementById('settings-birthday').value);
        formData.append('home_country', document.getElementById('settings-homecountry').value);
        formData.append('education', document.getElementById('settings-education').value);
        formData.append('workplace', document.getElementById('settings-job').value);
        formData.append('hobbies', document.getElementById('settings-hobbies').value);
        formData.append('fandoms', document.getElementById('settings-fandoms').value);
        formData.append('religion', document.getElementById('settings-religion').value);

        try {
            const response = await fetch('/api/users/update/bio', { method: 'POST', credentials: 'same-origin', body: formData });
            const data = await response.json();
            if (data.success) {
                localStorage.setItem('username', document.getElementById('settings-username').value);
                if (data.profilePicture) localStorage.setItem('userAvatar', data.profilePicture);
                alert('Сохранено!');
                window.location.reload();
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Ошибка сервера');
        }
    }

    async function saveSettingsSeq() {
        const payload = {
            show_posts_feed: document.getElementById('show-posts-feed').checked,
            show_posts_profile: parseInt(document.getElementById('who-posts').value),
            show_info_profile: parseInt(document.getElementById('who-info').value),
            show_friends_list: parseInt(document.getElementById('who-friends').value),
            show_communities_list: parseInt(document.getElementById('who-communities').value),
            show_audios: parseInt(document.getElementById('who-music').value),
            allow_messages_from: parseInt(document.getElementById('who-chat').value),
            anonymous_page: document.getElementById('anonymus-profile').checked
        };

        try {
            const response = await fetch('/api/users/update/seq', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.success) {
                alert('Сохранено!');
                window.location.reload();
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Ошибка сервера');
        }
    }

    async function saveSettingsCust() {
        const siteBg = document.getElementById('site-bg-select').files[0];
        const notifCheck = document.getElementById('notifications-check').checked ? 1 : 0;
const chatCheck = document.getElementById('chat-check').checked ? 1 : 0;
const newPostCheck = document.getElementById('new-post-check').checked ? 1 : 0;
const onlineCheck = document.getElementById('online-check').checked ? 1 : 0;
const friendsCheck = document.getElementById('friend-request-check').checked ? 1 : 0;
        const mascotBricked = false;
        const handHolding = document.getElementById('handholding-toggle').checked;

        // Save to localStorage
        localStorage.setItem('notifSound', notifCheck);
        localStorage.setItem('chatSound', chatCheck);
        localStorage.setItem('postSound', newPostCheck);
        localStorage.setItem('onlineSound', onlineCheck);
        localStorage.setItem('friendSound', friendsCheck);
        localStorage.setItem('mascotBricked', mascotBricked ? 1 : 0);
        localStorage.setItem('handHolding', handHolding ? 1 : 0);

        const formData = new FormData();
        formData.append('custom_background', siteBg || '');
        formData.append('notification_sound', notifCheck);
formData.append('chat_message_sound', chatCheck);
formData.append('post_sent_sound', newPostCheck);
formData.append('friend_online_sound', onlineCheck);
formData.append('friend_request_sound', friendsCheck);

        try {
            // Save customization
            const custResponse = await fetch('/api/users/update/cust', {
                method: 'POST',
                credentials: 'same-origin',
                body: formData
            });
            const custData = await custResponse.json();

            if (custData.success && custData.customBackground) {
                localStorage.setItem('customBg', custData.customBackground);
                document.body.style.backgroundImage = `url('${custData.customBackground}')`;
            }

            // Persist the selected mascot visibility explicitly.
            await fetch('/api/users/mascot/status', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bricked: mascotBricked ? 1 : 0 })
            });

            // Update handholding
            await fetch(`/api/users/mascot/handholding`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ complete: !handHolding }),
                credentials: 'same-origin'
            });

            alert('Сохранено!');
            window.location.reload();

        } catch (err) {
            console.error('Save error:', err);
            alert('Ошибка сервера');
        }
    }

    document.addEventListener('DOMContentLoaded', loadSettings);

    window.saveSettingsBio = saveSettingsBio;
    window.saveSettingsSeq = saveSettingsSeq;
    window.saveSettingsCust = saveSettingsCust;
    window.switchSettingsTab = switchSettingsTab;
}

// ============ GLOBAL SETTINGS LOADER ============
document.addEventListener('DOMContentLoaded', async () => {
    const sessionStarted = sessionStorage.getItem('sessionStarted');

    if (sessionStarted !== null) {
        loadUserSettings();
    } else {
        sessionStorage.setItem('sessionStarted', true);
        const userId = localStorage.getItem('userId');

        // Не дёргаем API для гостей — иначе уходит запрос на /api/users/cust/null
        if (userId) {
            try {
                const response = await fetch(`/api/users/cust/${userId}`, { credentials: 'same-origin' });
                const newData = await response.json();
                localStorage.setItem('customBg', newData.customBackground);
            } catch (error) {
                console.error('Error fetching user settings:', error);
            }
        }

        loadUserSettings();
    }
});