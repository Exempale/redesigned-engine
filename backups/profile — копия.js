let currentProfileUser = null
let isEditing = false
let newProfilePicture = null


function escapeHtml(str) {
  if (!str) return ''
  // Convert to string if it's not already
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
  const currentUserId = localStorage.getItem('userId')
  if (currentUserId) {
    window.location.href = `/profile.html?id=${currentUserId}`
  } else {
    window.location.href = '/login.html'
  }
}

function loadProfile() {
  Promise.all([
    fetch(`/api/users/${userId}`).then(r => r.json()),
    fetch(`/api/users/${userId}/posts`).then(r => r.json())
  ])
  .then(([user, posts]) => {
    if (user.error) throw new Error(user.error)
    currentProfileUser = user
    document.title = user.username
    displayProfile(user)
    displayUserPosts(posts)
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
  const currentUserId = await localStorage.getItem('userId')
  
  const postBox = document.getElementById('own-profile-post-box')
  if (postBox) {
    postBox.style.display = isOwnProfile ? 'block' : 'none'
  }
  
  if (isOwnProfile) {
    setTimeout(() => {
      setupPostButton()
      setupEnterKey()
      setupPasteSupport()
    }, 100)
  }
  
  let profilePictureHTML = ''
  let nameHTML = ''
  
  if (isEditing) {
    profilePictureHTML = `
      <div class="profile-picture-edit-container" onclick="document.getElementById('profile-picture-input').click()">
        <img src="${user.profilePicture || '/default-avatar.jpg'}" class="profile-picture ${newProfilePicture ? 'dimmed' : ''}">
        <div class="profile-picture-overlay">Изменить фото профиля</div>
        <input type="file" id="profile-picture-input" accept="image/*" style="display: none;" onchange="previewNewProfilePicture(event)">
      </div>
      ${newProfilePicture ? '<div class="new-picture-preview">Новое фото выбрано!</div>' : ''}
    `
    nameHTML = `
      <div class="name-container">
        <input type="text" id="edit-username" value="${user.username}" class="profile-name-input">
        <div class="name-background"></div>
      </div>
    `
  } else {
    profilePictureHTML = `
      <img src="${user.profilePicture || '/default-avatar.jpg'}" class="profile-picture frutiger-aero-border">
    `
    nameHTML = `
      <div class="name-container">
        <div class="name-background"></div>
        <h1 class="profile-name">${user.username}</h1>
      </div>
    `
  }
  
  // Status HTML - exactly like community.js
  let statusHTML = ''
  if (isOwnProfile) {
	if (user.status == '') {
	statusHTML = `
      <div class="status-background editable" id="profile-status-container">
        <span class="edit-status-hint" id="edit-profile-status-hint"><p class="profile-status" id="profile-status">добавить статус...</p></span>
        <textarea id="profile-status-input" class="status-input" style="display: none;" placeholder="Введите статус..."></textarea>
      </div>
    `
	} else {
    statusHTML = `
      <div class="status-background editable" id="profile-status-container">
        <span class="edit-status-hint" id="edit-profile-status-hint"><p class="profile-status" id="profile-status">${user.status}</p></span>
        <textarea id="profile-status-input" class="status-input" style="display: none;" placeholder="Введите статус..."></textarea>
      </div>
    ` }
  } else {
    statusHTML = `
      <div class="status-background" id="profile-status-container">
        <p class="profile-status" id="profile-status">${escapeHtml(user.status || ' ')}</p>
        <textarea id="profile-status-input" class="status-input" style="display: none;" placeholder="Введите статус..."></textarea>
      </div>
    `
  }
  
  // Main content HTML - same structure as community.js
  document.getElementById('profile-content').innerHTML = `
    <div class="profile-header">
      <div class="profile-header-content">
        <div class="profile-picture-container">
          ${profilePictureHTML}
        </div>
        
        <div class="profile-info">
          ${nameHTML}
          ${statusHTML}
          <div class="profile-actions" id="profile-actions">
            ${isOwnProfile 
              ? (isEditing 
                  ? '<button class="profile-btn" onclick="saveProfile()">Сохранить</button><button class="profile-btn" onclick="cancelEdit()">Отмена</button>'
                  : '<button class="profile-btn" onclick="enterEditMode()">Редактировать</button>')
              : '<button class="profile-btn" disabled>Загрузка...</button>'}
          </div>
        </div>
      </div>
      <div id = "profile-mobile-actions" style="display: flex; gap: 10px;">
      ${isOwnProfile 
              ? (isEditing 
                  ? '<button class="profile-btn-mobile" onclick="saveProfile()">Сохранить</button><button class="profile-btn" onclick="cancelEdit()">Отмена</button>'
                  : '<button class="profile-btn-mobile" onclick="enterEditMode()">Редактировать</button>')
              : '<button class="profile-btn-mobile" disabled>Загрузка...</button>'}
      </div>
      <div class="profile-stats">
        <div class="stat">
          <span class="stat-value">${user.postCount || 0}</span>
          <span class="stat-label">Публикаций</span>
        </div>
        <div class="stat">
          <span class="stat-value">${user.friends?.length || 0}</span>
          <span class="stat-label">Друзья</span>
        </div>
      </div>
    </div>
  `
  
  if (isOwnProfile) {
    setTimeout(() => {
      setupPostButton()
      setupEnterKey()
      setupPasteSupport()
      setupProfileStatusEditing()
    }, 100)
    return
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
        let mobileButtons = ''
        
        if (isFriend) {
          buttons = `
            <button class="profile-btn" onclick="openChatWithUser(${user.id})">Написать</button>
            <button class="profile-btn" onclick="removeFriend(${user.id})">Отключить друга</button>
          `
          mobileButtons = `
            <button class="profile-btn-mobile" onclick="openChatWithUser(${user.id})">Написать</button>
            <button class="profile-btn-mobile" onclick="removeFriend(${user.id})">Отключить друга</button>
          `
        } else if (hasPendingToMe) {
          buttons = `
            <button class="profile-btn accept-btn" onclick="acceptFriendRequest(${user.id})">Принять подключение</button>
            <button class="profile-btn reject-btn" onclick="rejectFriendRequest(${user.id})">Отклонить</button>
          `
          mobileButtons = `
            <button class="profile-btn-mobile accept-btn" onclick="acceptFriendRequest(${user.id})">Принять подключение</button>
            <button class="profile-btn-mobile reject-btn" onclick="rejectFriendRequest(${user.id})">Отклонить</button>
          `
        } else if (hasPendingFromMe) {
          buttons = `
            <button class="profile-btn" onclick="cancelFriendRequest(${user.id})">Отменить заявку</button>
            <button class="profile-btn" onclick="openChatWithUser(${user.id})">Связаться</button>
          `
          mobileButtons = `
            <button class="profile-btn-mobile" onclick="cancelFriendRequest(${user.id})">Отменить заявку</button>
            <button class="profile-btn-mobile" onclick="openChatWithUser(${user.id})">Связаться</button>
          `
        } else {
          buttons = `
            <button class="profile-btn" onclick="sendFriendRequest(${user.id})">Подключиться</button>
            <button class="profile-btn" onclick="openChatWithUser(${user.id})">Связаться</button>
          `
          mobileButtons = `
            <button class="profile-btn-mobile" onclick="sendFriendRequest(${user.id})">Подключиться</button>
            <button class="profile-btn-mobile" onclick="openChatWithUser(${user.id})">Связаться</button>
          `
        }
        
        document.getElementById('profile-actions').innerHTML = buttons
        document.getElementById('profile-mobile-actions').innerHTML = mobileButtons
      })
      .catch(err => {
        console.error('Error:', err)
        document.getElementById('profile-actions').innerHTML = `
          <button class="profile-btn" onclick="sendFriendRequest(${user.id})">Подключиться</button>
          <button class="profile-btn" onclick="openChatWithUser(${user.id})">Связаться</button>
        `
      })
  } else if (!isOwnProfile && !currentUserId) {
    document.getElementById('profile-actions').innerHTML = `
      <button class="profile-btn" onclick="window.location.href='/login.html'">Подключиться</button>
      <button class="profile-btn" onclick="window.location.href='/login.html'">Связаться</button>
    `
  }
}

function setupProfileStatusEditing() {
  const statusDisplay = document.getElementById('profile-status')
  const statusInput = document.getElementById('profile-status-input')
  const editStatusHint = document.getElementById('edit-profile-status-hint')
  const statusContainer = document.getElementById('profile-status-container')
  
  if (!statusDisplay || !statusInput) return
  
  const showStatusEditor = () => {
    statusInput.value = statusDisplay.textContent === 'нажмите чтобы добавить статус...' ? '' : statusDisplay.textContent
    statusDisplay.style.display = 'none'
    if (editStatusHint) editStatusHint.style.display = 'none'
    statusInput.style.display = 'block'
    statusInput.focus()
  }
  
  if (statusContainer) {
    statusContainer.addEventListener('click', showStatusEditor)
  }
  if (editStatusHint) {
    editStatusHint.addEventListener('click', showStatusEditor)
  }
  
  const saveStatus = async () => {
    const newStatus = statusInput.value.trim()
    if (newStatus !== statusDisplay.textContent && newStatus !== 'нажмите чтобы добавить статус...') {
      await saveProfileStatus(newStatus)
    }
    statusDisplay.textContent = newStatus || (isOwnProfile ? 'нажмите чтобы добавить статус...' : ' ')
    statusDisplay.style.display = 'block'
    statusInput.style.display = 'none'
    if (editStatusHint) editStatusHint.style.display = 'block'
  }
  
  statusInput.addEventListener('blur', saveStatus)
  statusInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveStatus()
    }
  })
}

async function saveProfileStatus(newStatus) {
  const currentUserId = localStorage.getItem('userId')
  if (!currentUserId) return
  
  const formData = new FormData()
  formData.append('status', newStatus)
  formData.append('userId', currentUserId)
  
  try {
    const response = await fetch('/api/users/update-status', {
      method: 'POST',
      body: formData
    })
    
    const data = await response.json()
    if (!data.success) {
      alert('Ошибка: ' + (data.error || 'Не удалось сохранить статус'))
    }
  } catch (err) {
    console.error('Error saving status:', err)
    alert('Ошибка сервера')
  }
}

import * as PostDisplay from './display-post.js'

function displayUserPosts(posts) {
  PostDisplay.loadUserMap().then(() => {
    PostDisplay.displayPosts('profile-feed', posts, loadProfile)
  })
}

function enterEditMode() {
  isEditing = true
  newProfilePicture = null
  loadProfile()
}

function cancelEdit() {
  isEditing = false
  newProfilePicture = null
  loadProfile()
}

function previewNewProfilePicture(event) {
  const file = event.target.files[0]
  if (!file) return
  
  newProfilePicture = file
  
  const allImages = document.querySelectorAll('.profile-picture')
  
  if (allImages.length > 0) {
    const preview = allImages[0]
    
    const reader = new FileReader()
    reader.onload = (e) => {
      preview.src = e.target.result
      preview.classList.add('dimmed')
      
      if (!document.querySelector('.new-picture-preview')) {
        const previewText = document.createElement('div')
        previewText.className = 'new-picture-preview'
        previewText.textContent = 'Новое фото выбрано!'
        previewText.style.marginTop = '10px'
        previewText.style.padding = '5px'
        previewText.style.background = '#4CAF50'
        previewText.style.color = 'white'
        previewText.style.borderRadius = '4px'
        previewText.style.textAlign = 'center'
        
        const container = preview.closest('.profile-picture-container') || 
                         document.querySelector('.profile-header')
        if (container) {
          container.appendChild(previewText)
        }
      }
    }
    reader.readAsDataURL(file)
  }
}

function saveProfile() {
  const newUsername = document.getElementById('edit-username')?.value
  const currentUsername = localStorage.getItem('username')
  
  if (!newUsername) {
    alert('Имя пользователя не может быть пустым')
    return
  }
  
  const formData = new FormData()
  formData.append('username', newUsername)
  formData.append('originalUsername', currentUsername)
  
  if (newProfilePicture) {
    formData.append('profilePicture', newProfilePicture)
  }
  
  fetch('/api/users/update', {
    method: 'POST',
    body: formData
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      if (newUsername !== currentUsername) {
        localStorage.setItem('username', newUsername)
        if (data.profilePicture) {
          localStorage.setItem('userAvatar', data.profilePicture)
        }
        // Need to get new userId after username change
        fetch(`/api/users/by-username/${newUsername}`)
          .then(r => r.json())
          .then(user => {
            localStorage.setItem('userId', user.id)
            window.location.href = `/profile.html?id=${user.id}`
          })
      } else {
        if (data.profilePicture) {
          localStorage.setItem('userAvatar', data.profilePicture)
        }
        isEditing = false
        newProfilePicture = null
        loadProfile()
      }
    } else {
      alert('Ошибка при сохранении: ' + data.error)
    }
  })
  .catch(err => {
    console.error('Save error:', err)
    alert('Ошибка сервера')
  })
}

// FRIEND FUNCTIONS (now using userIds)
function sendFriendRequest(toUserId) {
  const fromUserId = localStorage.getItem('userId')
  if (!fromUserId) {
    window.location.href = '/login.html'
    return
  }
    

  fetch('/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromUserId, toUserId })
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUserId,
      requesterUserId
    })
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUserId,
      requesterUserId
    })
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUserId,
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromUserId,
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
if (typeof window.toggleChatsPanel === 'function') {
        window.toggleChatsPanel()
        setTimeout(() => {
            if (typeof window.openChatWithUser === 'function') {
                window.openChatWithUser(friendUserId)
            }
        }, 100)
    }
}

function setupPostButton() {
  const postButton = document.getElementById('post-button')
  if (!postButton) return
  
  const newPostButton = postButton.cloneNode(true)
  postButton.parentNode.replaceChild(newPostButton, postButton)
  
  newPostButton.addEventListener('click', async function() {
    const content = document.getElementById('post-input').value.trim()
    const community = ''
    const isAnonymous = false
    const userId = localStorage.getItem('userId')
    
    if (!content && selectedFiles.length === 0) {
      return
    }
    
    const formData = new FormData()
    formData.append('content', content)
    formData.append('userId', userId)
    formData.append('community', community)
    formData.append('isAnonymous', isAnonymous)
    
    selectedFiles.forEach(file => {
      formData.append('files', file)
    })
    
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        body: formData
      })
      
      const data = await response.json()
      
      if (data.success) {
        document.getElementById('post-input').value = ''
        selectedFiles = []
        fileTypes = []
        document.getElementById('files-preview-area').innerHTML = ''
        togglePreviewVisibility()
        loadProfile()
      }
    } catch (err) {
      console.error('Error creating post:', err)
    }
  })
}

function setupEnterKey() {
  const postInput = document.getElementById('post-input')
  if (!postInput) return
  
  postInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const postButton = document.getElementById('post-button')
      if (postButton) postButton.click()
    }
  })
}

function setupPasteSupport() {
  const postInput = document.getElementById('post-input')
  if (!postInput) return
  
  postInput.addEventListener('paste', function(e) {
    const items = e.clipboardData.items
    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault()
        const file = item.getAsFile()
        const fileName = `pasted-image-${Date.now()}.png`
        const imageFile = new File([file], fileName, { type: file.type })
        
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(imageFile)
        document.getElementById('image-input').files = dataTransfer.files
        
        const fileInput = document.getElementById('image-input')
        fileInput.style.border = '2px solid green'
        setTimeout(() => {
          fileInput.style.border = ''
        }, 1000)
        break
      }
    }
  })
}

window.enterEditMode = enterEditMode
window.cancelEdit = cancelEdit
window.saveProfile = saveProfile
window.previewNewProfilePicture = previewNewProfilePicture
window.sendFriendRequest = sendFriendRequest
window.acceptFriendRequest = acceptFriendRequest
window.rejectFriendRequest = rejectFriendRequest
window.removeFriend = removeFriend
window.cancelFriendRequest = cancelFriendRequest

loadProfile()