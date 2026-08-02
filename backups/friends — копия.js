// friends.js
let currentFriendsData = null

// Загружаем друзей при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
  loadFriendsData()
})

function loadFriendsData() {
  const username = sessionStorage.getItem('username')
  if (!username) {
    return
  }
  
  fetch(`/api/friends/${username}`)
    .then(r => r.json())
    .then(data => {
      currentFriendsData = data
      displayFriends(data.friends)
      displayPending(data.pending)
      
      // Update friend notification count
      const pendingCount = data.pending.length
      updateFriendNotifications(pendingCount)
      
      document.getElementById('pending-count').textContent = pendingCount
      updateFriendsBadge(pendingCount)
    })
    .catch(err => {
      console.error('Error loading friends:', err)
    })
}

// Clear notifications when viewing friends page
document.addEventListener('DOMContentLoaded', function() {
  // Clear friend notifications when opening friends page
  clearFriendNotifications()
  loadFriendsData()
})

function displayFriends(friends) {
  const container = document.getElementById('friends-list')
  container.innerHTML = ''
  
  if (!friends || friends.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">У вас пока нет друзей</div>'
    return
  }
  
  friends.forEach(friend => {
    const friendCard = document.createElement('div')
    friendCard.classList.add('friend-card')
    
    friendCard.innerHTML = `
      <img src="${friend.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
      <div class="friend-card-info">
        <a href="/profile.html?user=${friend.username}" class="friend-card-name">${friend.username}</a>
      </div>
      <button class="friend-card-btn" onclick="messageFriend('${friend.username}')">Сообщение</button>
    `
    
    container.appendChild(friendCard)
  })
}

function displayPending(pending) {
  const container = document.getElementById('pending-list')
  container.innerHTML = ''
  
  if (!pending || pending.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">Нет новых заявок</div>'
    return
  }
  
  pending.forEach(requester => {
    const requestCard = document.createElement('div')
    requestCard.classList.add('friend-card')
    
    requestCard.innerHTML = `
      <img src="${requester.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
      <div class="friend-card-info">
        <a href="/profile.html?user=${requester.username}" class="friend-card-name">${requester.username}</a>
        <span class="friend-card-status">Хочет подключиться к вам в друзья</span>
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="friend-card-btn accept-btn" onclick="acceptRequest('${requester.username}')">Подключить</button>
        <button class="friend-card-btn reject-btn" onclick="rejectRequest('${requester.username}')">Отклонить</button>
      </div>
    `
    
    container.appendChild(requestCard)
  })
}

function acceptRequest(requesterUsername) {
  const currentUsername = sessionStorage.getItem('username')
  
  fetch('/api/friends/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUsername: currentUsername,
      requesterUsername: requesterUsername
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      loadFriendsData() // Перезагружаем списки
    }
  })
  .catch(err => console.error('Error accepting request:', err))
}

function rejectRequest(requesterUsername) {
  const currentUsername = sessionStorage.getItem('username')
  
  fetch('/api/friends/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUsername: currentUsername,
      requesterUsername: requesterUsername
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      loadFriendsData() // Перезагружаем списки
    }
  })
  .catch(err => console.error('Error rejecting request:', err))
}

function messageFriend(username) {
  // Открываем чат с этим другом
  if (typeof toggleChatsPanel === 'function') {
    toggleChatsPanel()
    setTimeout(() => {
      if (typeof openChat === 'function') {
        openChat(username)
      }
    }, 100)
  }
}

function updateFriendsBadge(count) {
  const friendsLink = document.querySelector('a[href="/friends.html"]')
  if (friendsLink && count > 0) {
    friendsLink.innerHTML = `Друзья <span style="background-color: #4CAF50; color: white; padding: 2px 6px; border-radius: 12px; font-size: 12px; margin-left: 5px;">${count}</span>`
  }
}

// Функция для добавления в друзья (будет вызываться из профиля)
function sendFriendRequest(toUsername) {
  const fromUsername = sessionStorage.getItem('username')
  
  fetch('/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromUsername: fromUsername,
      toUsername: toUsername
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Заявка отправлена!')
    } else {
      alert('Ошибка: ' + data.error)
    }
  })
  .catch(err => console.error('Error sending friend request:', err))
}

// Check for new friend requests every 30 seconds
setInterval(() => {
  if (!isUserLoggedIn()) return
  
  const username = sessionStorage.getItem('username')
  
  fetch(`/api/friends/${username}`)
    .then(r => r.json())
    .then(data => {
      const pendingCount = data.pending.length
      updateFriendNotifications(pendingCount)
    })
    .catch(err => console.error('Error checking friend requests:', err))
}, 30000)

document.addEventListener('DOMContentLoaded', function() {
  // Clear friend notifications when opening friends page
  clearFriendNotifications()
  loadFriendsData()
})

// Делаем функцию глобальной
window.sendFriendRequest = sendFriendRequest
window.acceptRequest = acceptRequest
window.rejectRequest = rejectRequest
window.messageFriend = messageFriend