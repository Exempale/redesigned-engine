// profile.js
let currentProfileUser = null
let isEditing = false
let newProfilePicture = null
let currentLastPostId = null;
let isLoading = false;
let hasMorePosts = true;
let allPosts = [];

function escapeHtml(str) {
  if (!str) return ''
  const string = String(str)
  return string
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function debug(msg) {
    const debugDiv = document.getElementById('debug-messages');
    if (debugDiv) {
        const timestamp = new Date().toLocaleTimeString();
        debugDiv.innerHTML += `<div>${timestamp}: ${msg}</div>`;
        debugDiv.scrollTop = debugDiv.scrollHeight;
        while (debugDiv.children.length > 20) {
            debugDiv.removeChild(debugDiv.firstChild);
        }
    }
    console.log(msg);
}

// Get user ID from URL
const urlParams = new URLSearchParams(window.location.search)
const userId = urlParams.get('id')

if (!userId) {
  if (currentUserId) {
    //window.location.href = `/profile.html?id=${currentUserId}`
  } else {
    //window.location.href = '/login.html'
  }
}

async function loadFriendsList() {
    const container = document.getElementById('friends-sub-container');
    const label = document.getElementById('friends-label');
    if (!container) return;
    
        const response = await fetch(`/api/users/${userId}/friends`);
        const friends = await response.json();
	if (label) {
            label.textContent = `Друзья (${friends.length})`;
        }
        
        if (!friends || friends.length === 0) {
            const parentLabel = container.parentElement.parentElement;
            if (parentLabel) parentLabel.style.display = 'none';
            checkSubscriptionsVisibility();
            return;
        }
        
        const shuffled = [...friends].sort(() => Math.random() - 0.5);
        const displayFriends = shuffled.slice(0, 6);
        let html = '';
        
        displayFriends.forEach(friend => {
            html += `
                <a href="/profile?id=${friend.id}" class="sub-sub-item">
                    <img src="${friend.profilePicture || '/default-avatar.jpg'}" class="sub-sub-avatar">
                    <span class="role-identity-line sub-sub-name-line">
                        <span class="sub-sub-name role-name${friend.displayRole ? ` role-name-${friend.displayRole}` : ''}">${escapeHtml(friend.username)}</span>
                        ${window.FortPortRoles?.badgeHtml(friend, { compact: true }) || ''}
                    </span>
                </a>
            `;
        });
        
        const emptySlots = 6 - displayFriends.length;
        for (let i = 0; i < emptySlots; i++) {
            html += '<div class="sub-sub-item sub-sub-empty-slot"></div>';
        }
        
        container.innerHTML = html;
        checkSubscriptionsVisibility();
}

async function loadCommunitiesList() {
    const container = document.getElementById('communities-sub-container');
    const label = document.getElementById('communities-label');

        const response = await fetch(`/api/users/${userId}/communities`);
        const communities = await response.json();

	if (label) {
            label.textContent = `Порты (${communities.length})`;
        }
        
        if (!communities || communities.length === 0) {
            const parentLabel = container.parentElement.parentElement;
            if (parentLabel) parentLabel.style.display = 'none';
            checkSubscriptionsVisibility();
            return;
        }
        
        const shuffled = [...communities].sort(() => Math.random() - 0.5);
	const displayCommunities = shuffled.slice(0, 6);
        let html = '';
        
        displayCommunities.forEach(community => {
            html += `
                <a href="/community?id=${community.id}" class="sub-sub-item">
                    <img src="${community.profilePicture || '/default-avatar.jpg'}" class="sub-sub-avatar">
                    <span class="sub-sub-name">${escapeHtml(community.username)}</span>
                </a>
            `;
        });
        
        const emptySlots = 6 - displayCommunities.length;
        for (let i = 0; i < emptySlots; i++) {
            html += '<div class="sub-sub-item sub-sub-empty-slot"></div>';
        }
        
        container.innerHTML = html;
        checkSubscriptionsVisibility();
}

async function loadAudiosList() {
    const container = document.getElementById('audios-sub-container');
    const label = document.getElementById('audios-label');

        const response = await fetch(`/api/users/audios?userId=${userId}`);
        const resJson = await response.json();
        const audios = resJson.audios;

	if (label) {
            label.textContent = `Аудио (${audios.length})`;
        }

    if (!container) return;
        
        if (!audios || audios.length === 0) {
            container.parentElement.style.display = 'none';
            container.parentElement.parentElement.style.paddingBottom = '20px';
            checkSubscriptionsVisibility();
            return;
        }
        
        const shuffled = [...audios].sort(() => Math.random() - 0.5);
	const displayAudios = shuffled.slice(0, 2);
        let html = '';
        
        displayAudios.forEach(audio => {
            html += `
		<div style="display:flex;flex-direction:row; gap:10px; width:50%;">
                    <img src="/ui/icons/audios_aero.webp" style="width:48px; height:48px; background:white; border-radius:4px; border: 2px solid #cccfe0;">
		<div style="display:flex;flex-direction:column;">
                    <span class="profile-audio-name">${escapeHtml(audio.name)}</span>
                    <span class="profile-audio-subname">${escapeHtml(audio.artist_name)}</span>
            	</div>
            	</div>
		`;
        });
        
        container.innerHTML = html;
        checkSubscriptionsVisibility(); 
}

function checkSubscriptionsVisibility() {
    const container = document.querySelector('.profile-box-container');
    if (!container) return;
    
    const friendsVisible = document.getElementById('friends-sub-container')?.parentElement?.style.display !== 'none';
    const communitiesVisible = document.getElementById('communities-sub-container')?.parentElement?.style.display !== 'none';
    
    if (!friendsVisible && !communitiesVisible) {
        container.style.display = 'none';
    } else {
        container.style.display = 'flex';
    }
}

function loadProfile() {
  // Reset pagination
  currentLastPostId = null;
  hasMorePosts = true;
  isLoading = false;
  allPosts = [];
  
  Promise.all([
    fetch(`/api/users/${userId}`).then(r => r.json()),
    fetch(`/api/users/${userId}/posts`).then(r => r.json())
  ])
  .then(([user, posts]) => {
    if (user.error) throw new Error(user.error)
    currentProfileUser = user
    document.title = user.username
    displayProfile(user)
    
    // Store posts and display
    allPosts = posts;
    if (posts.length > 0) {
        currentLastPostId = posts[posts.length - 1].id;
    }
    if (posts.length < 15) {
        hasMorePosts = false;
    }
    displayUserPosts(allPosts);
  })
  .catch(err => {
    document.getElementById('profile-content').innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ff4444;">
        Пользователь не найден
      </div>
    `
  })
}

function displayProfile(user) {
  const currentUserId = localStorage.getItem('userId')
  const isOwnProfile = (currentUserId == user.id)
  renderProfile(user, isOwnProfile)
}

async function renderProfile(user, isOwnProfile) {
  const currentUserId = localStorage.getItem('userId')
  let capabilities = window.sessionBootstrap?.user || {
    isAdmin: localStorage.getItem('isAdmin') === 'true',
    isDeveloper: localStorage.getItem('isDeveloper') === 'true',
    isModerator: false
  }
  if (currentUserId && !window.sessionBootstrap) {
    try {
      const capabilityResponse = await fetch('/api/isAdmin', { credentials: 'same-origin' })
      if (capabilityResponse.ok) capabilities = await capabilityResponse.json()
    } catch (error) {
      console.error('Profile capability check failed:', error)
    }
  }
  const canModerateProfile = Boolean(
    capabilities.isAdmin || capabilities.isDeveloper || capabilities.isModerator
  )
  	const userBioResponse = await fetch(`/api/users/bio/${userId}`);
	const userBio = await userBioResponse.json();

  if (userBio.profileBackground) {
    const body = document.body
    body.style.backgroundImage = `url(${userBio.profileBackground})`
  }
  
  const postBox = document.getElementById('own-profile-post-box')
  if (postBox) {
    postBox.style.display = isOwnProfile ? 'block' : 'none'
  }

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-header">
	<div class="profile-header-contents">
		<div class="profile-header-left">
			<div class="profile-pfp">
				<img src="${user.profilePicture || '/default-avatar.jpg'}" class="profile-picture frutiger-aero-border" style="border-radius:0; border: 6px solid rgb(255 255 255); box-shadow: 4px 4px 18px #0000008f; cursor:pointer;" onclick="openProfilePicture('${user.profilePicture || ''}')">
			</div>
			<div class="profile-left-buttons" id="profile-buttons"></div>
		</div>
		<div class="profile-header-right">
			<div class="profile-right-name">
                <span class="role-identity-line profile-name-line">
                    <span class="profile-name-text role-name${user.displayRole ? ` role-name-${user.displayRole}` : ''}">${escapeHtml(user.username)}</span>
                    ${window.FortPortRoles?.badgeHtml(user, { profile: true }) || ''}
                </span>
            </div>
			${user.status ? `<div class="profile-right-status">${escapeHtml(user.status)}</div>` : ``}
			${userBio.description ? `<div class="profile-right-description">${userBio.description}</div>` : ``}
			${userBio.homeCountry ? `<div class="profile-right-homecountry"><img src="/ui/icons/mini_map.webp" style="height:30px; position:absolute; left:10px; bottom:5px;">${userBio.homeCountry}</div>` : ``}
			${userBio.dateOfBirth ? `<div class="profile-right-birthday"><img src="/ui/icons/mini_cake.webp" style="height:30px; position:absolute; right:10px; bottom:5px;">${userBio.dateOfBirth}</div>` : ``}
		</div>
		<div class="profile-header-morethings" onclick="openMore()">Ещё</div>
		<div class="profile-header-somethings">
			<div class="profile-header-somethings-thing"><a href="/friends/?id=${user.id}" style="display: flex; justify-content: center; align-items: center; gap:5px;"><img src="/ui/icons/friends_aero.webp" style="height:32px; width:auto;"><span id="friends-label">Друзья</span></a></div>
			<div class="profile-header-somethings-thing"><a href="/communities/?id=${user.id}" style="display: flex; justify-content: center; align-items: center; gap:5px;"><img src="/ui/icons/communities_aero.webp" style="height:32px; width:auto;"><span id="communities-label">Порты</span></a></div>
			<div class="profile-header-somethings-thing"><a href="/audios?id=${user.id}" style="display: flex; justify-content: center; align-items: center; gap:5px;"><img src="/ui/icons/audios_aero.webp" style="height:32px; width:auto;"><span id="audios-label">Аудиозаписи</span></a></div>
		</div>
	</div>
    </div>
    <div class="profile-neck">
	<div class="profile-neck-left">
		${userBio.education ? `<p><span style="color: #575757;">Образование:</span> ${userBio.education}</p>` : ``}
		${userBio.workplace ? `<p><span style="color: #575757;">Работа:</span> ${userBio.workplace}</p>` : ``}
		${userBio.religion ? `<p><span style="color: #575757;">Религия:</span> ${userBio.religion}</p>` : ``}
                ${((userBio.education || userBio.workplace || userBio.religion) && (userBio.hobbies || userBio.fandoms)) ? `<div class="profile-neck-separator"></div>` : ``}
		${userBio.hobbies ? `<p><span style="color: #575757;">Хобби:</span> ${userBio.hobbies}</p>` : ``}
                ${userBio.hobbies ? `<div class="profile-neck-separator"></div>` : ``}
		${userBio.fandoms ? `<p><span style="color: #575757;">Фандомы:</span> ${userBio.fandoms}</p>` : ``}
	</div>
	<div class="profile-neck-right">
		<div class="profile-neck-right-top">
			<div class="profile-things-container">
				<label>Порты:</label>
				<div id="communities-sub-container">
				</div>
			</div>
			<div class="profile-things-container">
				<label>Друзья:</label>
				<div id="friends-sub-container">
				</div>
			</div>
		</div>
		<div class="profile-audios-container">
			<label>Музыка:</label>
			<div id="audios-sub-container" style="display:flex;flex-direction:row;">
			</div>
		</div>
    	</div>
    </div>
    <div class="profile-header-lessthings" onclick="closeMore()">Скрыть</div>
  `
  
  loadFriendsList();
  loadCommunitiesList();
  loadAudiosList();

  if (isOwnProfile) {
    setTimeout(() => {
      setupPostButton()
      setupEnterKey()
      setupPasteSupport()
    }, 100)
	document.getElementById('profile-buttons').innerHTML = `
      <button class="profile-btn-btn" onclick="window.location.href='/settings'" style="margin-bottom: 55px;">Редактировать</button>
    `
    return
  }

  if (!isOwnProfile && canModerateProfile) {
    const moderationButton = document.createElement('button')
    moderationButton.type = 'button'
    moderationButton.className = 'profile-btn-btn profile-reset-avatar-btn'
    moderationButton.textContent = 'Сбросить аватар'
    moderationButton.addEventListener('click', () => resetUserAvatar(user.id, user.username))
    document.getElementById('profile-buttons').appendChild(moderationButton)
  }

  if (!isOwnProfile && currentUserId) {
    fetch(`/api/users/${currentUserId}`)
      .then(r => r.json())
      .then(currentUserData => {
        return fetch(`/api/users/${user.id}`)
          .then(r => r.json())
          .then(profileUserData => {
            return { currentUserData, profileUserData }
          })
      })
      .then(({ currentUserData, profileUserData }) => {
        const profileUserId = profileUserData.id
        const currentUserIdNum = currentUserId

        const isFriend = currentUserData.friends?.includes(profileUserId)
        const hasPendingToMe = currentUserData.pending?.includes(profileUserId)
        const hasPendingFromMe = profileUserData.pending?.includes(currentUserIdNum)
        
        let buttons = ''
        
        if (isFriend) {
          buttons = `
            <button class="profile-btn-btn" onclick="openChatWithUser(${user.id})">Написать</button>
            <button class="profile-btn-btn" onclick="removeFriend(${user.id})">Отключить Друга</button>
          `
        } else if (hasPendingToMe) {
          buttons = `
            <button class="profile-btn accept-btn" onclick="acceptFriendRequest(${user.id})">Принять подключение</button>
            <button class="profile-btn reject-btn" onclick="rejectFriendRequest(${user.id})">Отклонить</button>
          `
        } else if (hasPendingFromMe) {
          buttons = `
            <button class="profile-btn-btn" onclick="cancelFriendRequest(${user.id})">Отменить заявку</button>
            <button class="profile-btn-btn" onclick="openChatWithUser(${user.id})">Написать</button>
          `
        } else {
          buttons = `
            <button class="profile-btn-btn add-friend" onclick="sendFriendRequest(${user.id})">Добавить в Друзья</button>
            <button class="profile-btn-btn send-message" onclick="openChatWithUser(${user.id})">Написать</button>
          `
        }
        
        document.getElementById('profile-buttons').innerHTML += buttons
      })
      .catch(err => {
        console.error('Error:', err)
        document.getElementById('profile-buttons').innerHTML += `
            <button class="profile-btn-btn add-friend" onclick="sendFriendRequest(${user.id})">Добавить в Друзья</button>
            <button class="profile-btn-btn send-message" onclick="openChatWithUser(${user.id})">Написать</button>
        `
      })
  } else if (!isOwnProfile && !currentUserId) {
    document.getElementById('profile-buttons').innerHTML += `
      <button class="profile-btn-btn" onclick="window.location.href='/login'">Добавить в Друзья</button>
      <button class="profile-btn-btn" onclick="window.location.href='/login'">Написать</button>
    `
  }
}

async function resetUserAvatar(targetUserId, username) {
  const confirmed = window.confirm(`Сбросить аватар пользователя ${username} на стандартный?`)
  if (!confirmed) return

  const button = document.querySelector('.profile-reset-avatar-btn')
  if (button) button.disabled = true

  try {
    const response = await fetch(`/api/mod/users/${encodeURIComponent(targetUserId)}/avatar`, {
      method: 'DELETE',
      credentials: 'same-origin'
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Не удалось сбросить аватар')
    }

    const picture = document.querySelector('.profile-picture')
    if (picture) {
      picture.src = '/default-avatar.jpg'
      picture.onclick = null
    }
    if (button) button.textContent = 'Аватар сброшен'
  } catch (error) {
    if (button) button.disabled = false
    window.alert(error.message)
  }
}

function openMore() {
	const neck = document.querySelector('.profile-neck')
	neck.classList.add('open')
	const open = document.querySelector('.profile-header-morethings')
	open.style.transform = "scaleY(0)"
	const close = document.querySelector('.profile-header-lessthings')
	close.style.transform = "scaleY(1)"
	const somethings = document.querySelectorAll('.profile-header-somethings-thing');
	somethings.forEach(el => el.style.transform = "scaleY(0)");
}

function closeMore() {
	const neck = document.querySelector('.profile-neck')
	neck.classList.remove('open')
	const open = document.querySelector('.profile-header-morethings')
	open.style.transform = ''
	const close = document.querySelector('.profile-header-lessthings')
	close.style.transform = ''
	const somethings = document.querySelectorAll('.profile-header-somethings-thing');
	somethings.forEach(el => el.style.transform = '');
}

import * as PostDisplay from './display-post.js'

function displayUserPosts(posts, append = false) {
  PostDisplay.loadUserMap().then(() => {
    if (append) {
      PostDisplay.appendPosts('profile-feed', posts, loadProfile);
    } else {
      PostDisplay.displayPosts('profile-feed', posts, loadProfile);
    }
  })
}

// Load more profile posts
async function loadMoreProfilePosts() {
    if (isLoading || !hasMorePosts) return;
    
    isLoading = true;
    
    try {
        const url = `/api/users/${userId}/posts?before=${currentLastPostId}&limit=15`;
        const response = await fetch(url);
        const newPosts = await response.json();
        
        if (!newPosts || newPosts.length === 0) {
            hasMorePosts = false;
            isLoading = false;
            return;
        }
        
        allPosts = [...allPosts, ...newPosts];
        currentLastPostId = newPosts[newPosts.length - 1].id;
        
        if (newPosts.length < 15) {
            hasMorePosts = false;
        }
        
        // APPEND the new posts (not replace)
        displayUserPosts(newPosts, true);
        
    } catch (err) {
        console.error('Error loading more profile posts:', err);
    } finally {
        isLoading = false;
    }
}

function sendFriendRequest(toUserId) {
  const fromUserId = localStorage.getItem('userId')
  if (!fromUserId) {
    window.location.href = '/login.html'
    return
  }

  fetch('/api/friends/request', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toUserId })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Заявка в друзья отправлена!')
      loadProfile()
    } else {
      alert('Ошибка: ' + (data.error || 'Не удалось отправить заявку'))
    }
  })
}

function acceptFriendRequest(requesterUserId) {
  const currentUserId = localStorage.getItem('userId')
  
  fetch('/api/friends/accept', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterUserId })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Заявка принята!')
      loadProfile()
    }
  })
}

function rejectFriendRequest(requesterUserId) {
  const currentUserId = localStorage.getItem('userId')
  
  fetch('/api/friends/reject', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterUserId })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Заявка отклонена')
      loadProfile()
    }
  })
}

function removeFriend(friendUserId) {
  const currentUserId = localStorage.getItem('userId')
  
  if (!confirm(`Удалить друга?`)) return
  
  fetch('/api/friends/remove', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      friendId: friendUserId
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Пользователь удалён из друзей')
      loadProfile()
    }
  })
}

function cancelFriendRequest(toUserId) {
  const fromUserId = localStorage.getItem('userId')
  
  fetch('/api/friends/cancel', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toUserId
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Заявка отменена')
      loadProfile()
    }
  })
}

function openChatWithUser(userId) {
    window.location.href = `/chats?id=${userId}`;
}

// Scroll listener for profile
function setupProfileScrollListener() {
    window.addEventListener('scroll', () => {
        const scrollHeight = document.documentElement.scrollHeight;
        const scrollTop = window.scrollY;
        const clientHeight = window.innerHeight;
        
        if (scrollHeight - (scrollTop + clientHeight) < 300) {
            loadMoreProfilePosts();
        }
    });
}

window.openMore = openMore
window.closeMore = closeMore
window.sendFriendRequest = sendFriendRequest
window.acceptFriendRequest = acceptFriendRequest
window.rejectFriendRequest = rejectFriendRequest
window.removeFriend = removeFriend
window.cancelFriendRequest = cancelFriendRequest
window.openChatWithUser = openChatWithUser

loadProfile();
setupProfileScrollListener();