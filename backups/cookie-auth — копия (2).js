// cookie-auth.js


// cookie-auth.js - Add this function
async function verifySession() {
    try {
        const response = await fetch('/api/verify-session')
        if (response.ok) {
            const data = await response.json()
            return true
        }
    } catch (err) {
        console.log('Session verification failed')
    }
    
    // Session invalid - force logout
    clearUserData()
    
    // Show message to user
    if (window.location.pathname !== '/login.html' && 
        window.location.pathname !== '/register.html') {
        alert('Your session has expired. Please log in again.')
        window.location.href = '/login.html'
    }
    return false
}

// Call this on DOMContentLoaded BEFORE updateAuthButtons
document.addEventListener('DOMContentLoaded', async () => {
    const isValid = await verifySession()
    if (isValid) {
        syncFromLocalStorage()
    }
    updateAuthButtons()
})

async function authenticatedFetch(url, options = {}) {
    const response = await fetch(url, options)
    
    if (response.status === 401) {
        // Session expired
        clearUserData()
        alert('Session expired. Please log in again.')
        window.location.href = '/login.html'
        throw new Error('Unauthorized')
    }
    
    return response
}
// Save user data to both sessionStorage (for current tab) and cookies (for persistence)
function setUserData(userData) {
    // ONLY store display info, NOT auth state!
    sessionStorage.setItem('username', userData.username)
    sessionStorage.setItem('userAvatar', userData.profilePicture || '/default-avatar.jpg')
    
    // DON'T store userId - get it from /api/me endpoint instead
    // DON'T store isAdmin - check via server endpoint
}

// Clear user data from both storages
function clearUserData() {
  sessionStorage.clear()
  localStorage.removeItem('userId')
  localStorage.removeItem('username')
  localStorage.removeItem('isAdmin')
  localStorage.removeItem('userAvatar')
}

// Check if user is logged in (across tabs)
async function isUserLoggedIn() {
    try {
        const response = await fetch('/api/verify-session');
        return response.ok;
    } catch {
        return false;
    }
}

// Get user data from localStorage (persists across tabs)
function getUserData() {
  return {
    userId: localStorage.getItem('userId'),
    username: localStorage.getItem('username'),
    isAdmin: localStorage.getItem('isAdmin') === 'true',
    userAvatar: localStorage.getItem('userAvatar') || '/default-avatar.jpg'
  }
}

// Sync sessionStorage from localStorage (call on page load)
function syncFromLocalStorage() {
  const userId = localStorage.getItem('userId')
  const username = localStorage.getItem('username')
  const isAdmin = localStorage.getItem('isAdmin')
  const userAvatar = localStorage.getItem('userAvatar')
  
  if (userId) {
    sessionStorage.setItem('userId', userId)
    sessionStorage.setItem('username', username)
    sessionStorage.setItem('isAdmin', isAdmin || 'false')
    sessionStorage.setItem('userAvatar', userAvatar || '/default-avatar.jpg')
    return true
  }
  return false
}
// ============ NOTIFICATION FUNCTIONS ============

// Update friend notification count
function updateFriendNotifications(count) {
  localStorage.setItem('friendNotifications', count.toString())
  updateNotificationBadges()
}

// Update chat notification count
function updateChatNotifications(count) {
  localStorage.setItem('chatNotifications', count.toString())
  updateNotificationBadges()
}

// Get friend notification count
function getFriendNotifications() {
  return parseInt(localStorage.getItem('friendNotifications') || '0')
}

// Get chat notification count
function getChatNotifications() {
  return parseInt(localStorage.getItem('chatNotifications') || '0')
}

// Clear friend notifications
function clearFriendNotifications() {
  localStorage.setItem('friendNotifications', '0')
  updateNotificationBadges()
}

// Clear chat notifications
function clearChatNotifications() {
  localStorage.setItem('chatNotifications', '0')
  updateNotificationBadges()
}

// Update all notification badges in the UI
function updateNotificationBadges() {
  const friendCount = getFriendNotifications()
  const chatCount = getChatNotifications()
  
  // Update friends link
  const friendsLink = document.querySelector('a[href="/friends.html"]')
  if (friendsLink) {
    let badge = friendsLink.querySelector('.notification-badge')
    if (friendCount > 0) {
      if (!badge) {
        badge = document.createElement('span')
        badge.classList.add('notification-badge')
        friendsLink.appendChild(badge)
      }
      badge.textContent = friendCount > 9 ? '9+' : friendCount
    } else {
      if (badge) badge.remove()
    }
  }
  
  // Update chats toggle button
  const chatsToggle = document.getElementById('chats-toggle')
  if (chatsToggle) {
    let badge = chatsToggle.querySelector('.notification-badge')
    if (chatCount > 0) {
      if (!badge) {
        badge = document.createElement('span')
        badge.classList.add('notification-badge')
        chatsToggle.appendChild(badge)
      }
      badge.textContent = chatCount > 9 ? '9+' : chatCount
    } else {
      if (badge) badge.remove()
    }
  }
}

// Make functions global
window.setUserData = setUserData
window.clearUserData = clearUserData
window.isUserLoggedIn = isUserLoggedIn
window.getUserData = getUserData
window.syncFromLocalStorage = syncFromLocalStorage
window.updateFriendNotifications = updateFriendNotifications
window.updateChatNotifications = updateChatNotifications
window.getFriendNotifications = getFriendNotifications
window.getChatNotifications = getChatNotifications
window.clearFriendNotifications = clearFriendNotifications
window.clearChatNotifications = clearChatNotifications
window.updateNotificationBadges = updateNotificationBadges