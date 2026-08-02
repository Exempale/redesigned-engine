let chatsPanel = null
let currentChatId = null
let currentChatWith = null
let updateInterval = null
let lastMessageCount = {}  // Track message counts per chat
let lastMessages = {}      // Store last message for quick comparison
let lastViewedMessage = {}


if (!sessionStorage.getItem('userId')) {
    syncFromLocalStorage()
}

// Создаём панель чатов
function createChatsPanel() {
  if (document.getElementById('chats-panel')) {
    chatsPanel = document.getElementById('chats-panel')
    return
  }
  
  chatsPanel = document.createElement('div')
  chatsPanel.id = 'chats-panel'
  chatsPanel.classList.add('chats-panel')
  document.body.appendChild(chatsPanel)
}

// Открыть/закрыть панель
function toggleChatsPanel() {
  createChatsPanel()
  
  if (chatsPanel.classList.contains('open')) {
    chatsPanel.classList.remove('open')
    if (updateInterval) {
      clearInterval(updateInterval)
      updateInterval = null
    }
  } else {
    chatsPanel.classList.add('open')
    showChatsList()
  }
}

// Показать список чатов
async function showChatsList() {
  const username = sessionStorage.getItem('username')
  if (!username) return
  
  try {
    const response = await fetch(`/api/user_chats/${username}`)
    const chats = await response.json()
    
    chats.sort((a, b) => {
  const timeA = a.lastMessageTime ? new Date(a.lastMessageTime) : new Date(0)
  const timeB = b.lastMessageTime ? new Date(b.lastMessageTime) : new Date(0)
  return timeB - timeA
})
    const usersResponse = await fetch('/api/users')
    const users = await usersResponse.json()
    const userMap = {}
    users.forEach(user => {
      userMap[user.username] = user.profilePicture
    })
    
    // Import crypto functions for decryption
    const { decryptMessage, isEncrypted } = await import('./crypto-utils.js')
    
    let html = `
      <div class="chats-friends-view">
        <div class="chats-header">
          <h3>Переписки</h3>
        </div>
        <div class="chats-list" id="chats-list">
    `
    
    if (chats.length === 0) {
      html += '<div class="no-chats-message">У вас пока нет чатов</div>'
    } else {
      // Process each chat to decrypt the last message
      for (const chat of chats) {
        const avatar = userMap[chat.withUser] || '/default-avatar.jpg'
        const time = chat.lastMessageTime ? new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
        
        // Decrypt the last message preview
        let preview = chat.lastMessage
        if (preview && preview !== 'Нет сообщений') {
          // Extract just the message content from the full formatted message
          // Format is: timestamp_username:encryptedContent
          const colonIndex = preview.indexOf(':')
          if (colonIndex !== -1) {
            const encryptedContent = preview.substring(colonIndex + 1)
            
            // Check if it's encrypted and decrypt
            if (isEncrypted(encryptedContent)) {
              try {
                const decrypted = await decryptMessage(chat.chatId, encryptedContent)
                preview = decrypted
                // Truncate if too long
                if (preview.length > 30) {
                  preview = preview.substring(0, 30) + '...'
                }
              } catch (err) {
                console.error('Failed to decrypt preview:', err)
                preview = '[Encrypted]'
              }
            } else {
              // Not encrypted, just show the content
              preview = encryptedContent
            }
          } else {
            // Old format or plain text
            preview = 'Новое сообщение'
          }
        } else {
          preview = 'Нет сообщений'
        }
        
        html += `
          <div class="chat-item" onclick="openChat('${chat.chatId}', '${chat.withUser}')">
            <img src="${avatar}" class="chat-item-avatar frutiger-aero-border">
            <div class="chat-item-info">
              <div class="chat-item-name">${chat.withUser}</div>
              <div class="chat-item-preview">${preview}</div>
            </div>
            <div class="chat-item-time">${time}</div>
          </div>
        `
      }
    }
    
    html += '</div></div>'
    chatsPanel.innerHTML = html
    
    // Make the container shrink to fit content
    makeChatsListShrink()
    
  } catch (err) {
    console.error('Error loading chats:', err)
  }
}

// Открыть конкретный чат
async // Open chat with specific friend
function openChat(chatId, withUser) {
  currentChatId = chatId
  currentChatWith = withUser
  
  const username = sessionStorage.getItem('username')
  const chatsPanel = document.getElementById('chats-panel')
  
  // Get friend's profile picture
  fetch(`/api/users/${withUser}`)
    .then(r => r.json())
    .then(userData => {
      const avatar = userData.profilePicture || '/default-avatar.jpg'
      
      chatsPanel.innerHTML = `
        <div class="chat-view">
          <div class="chat-header">
            <button class="back-to-chats" onclick="backToChatsList()">←</button>
            <div class="chat-with-info">
              <img src="${avatar}" class="chat-with-avatar frutiger-aero-border">
              <span class="chat-with-name">${withUser}</span>
            </div>
          </div>
          
          <div class="messages-container" id="messages-container-${chatId}">
            <div style="text-align: center; padding: 20px;">Loading messages...</div>
          </div>
          
          <div class="message-input-area">
            <textarea id="message-input-${chatId}" placeholder="Написать сообщение..." rows="2"></textarea>
            <button onclick="sendMessage('${chatId}', '${withUser}')">Отправить</button>
          </div>
        </div>
      `
      
      loadMessages(chatId, withUser, username)
      
      setTimeout(() => {
        const input = document.getElementById(`message-input-${chatId}`)
        if (input) {
          input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendMessage(chatId, withUser)
            }
          })
        }
      }, 100)
    })
  
  if (window.messageInterval) {
    clearInterval(window.messageInterval)
  }
  
  window.messageInterval = setInterval(() => {
    if (currentChatId === chatId) {
      loadMessages(chatId, withUser, username, true)
    }
  }, 2000)
}

// Smart load messages - only updates if there are new messages
async function loadMessages(chatId, withUser, currentUser, isUpdate = false) {
  try {
    const response = await fetch(`/api/chat_messages/${chatId}`)
    const messages = await response.json()
    
    const messagesContainer = document.getElementById(`messages-container-${chatId}`)
    if (!messagesContainer) return
    
    // Check if we have new messages
    const currentCount = messages.length
    const previousCount = lastMessageCount[chatId] || 0
    
    // If this is an update check and no new messages, do nothing
    if (isUpdate && currentCount <= previousCount) {
      return
    }
    
    // Import crypto functions
    const { decryptMessage, isEncrypted } = await import('./crypto-utils.js')
    
    // If this is first load or we have new messages, rebuild everything
    if (!isUpdate || currentCount > previousCount) {
      let messagesHTML = ''
      
      if (messages.length === 0) {
        messagesHTML = '<div class="no-messages">Нет сообщений. Напишите что-нибудь!</div>'
      } else {
        // Process messages in parallel for speed
        const messagePromises = messages.map(async (msg) => {
          // Split by first underscore
          const underscoreIndex = msg.indexOf('_')
          const timestamp = msg.substring(0, underscoreIndex)
          const rest = msg.substring(underscoreIndex + 1)
          
          // Split by colon to get sender and content
          const colonIndex = rest.indexOf(':')
          const sender = rest.substring(0, colonIndex)
          let content = rest.substring(colonIndex + 1)
          
          // Decrypt if encrypted
          if (isEncrypted(content)) {
            content = await decryptMessage(chatId, content)
          }
          
          const isMine = sender === currentUser
          const time = new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })
          
          return {
            html: `
              <div class="message ${isMine ? 'message-mine' : 'message-theirs'}">
                <div class="message-text">${content}</div>
                <div class="message-time">${time}</div>
              </div>
            `,
            timestamp
          }
        })
        
        const messageElements = await Promise.all(messagePromises)
        // Sort by timestamp
        messageElements.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        messagesHTML = messageElements.map(e => e.html).join('')
      }
      
      messagesContainer.innerHTML = messagesHTML
      messagesContainer.scrollTop = messagesContainer.scrollHeight
      
      // Update the message count
      lastMessageCount[chatId] = currentCount
    }
    
  } catch (err) {
    console.error('Error loading messages:', err)
  }
}


// Update sendMessage to use the specific input
async function sendMessage(chatId, withUser) {
  const input = document.getElementById(`message-input-${chatId}`)
  if (!input) return
  
  const message = input.value.trim()
  if (!message) return
  
  const username = sessionStorage.getItem('username')
  const timestamp = new Date().toISOString()
  
  try {
    // Import crypto functions
    const { encryptMessage } = await import('./crypto-utils.js')
    
    // Encrypt the message
    const encryptedContent = await encryptMessage(chatId, message)
    
    // Format: timestamp_username:encryptedContent
    const formattedMessage = `${timestamp}_${username}:${encryptedContent}`
    
    await fetch(`/api/chat_messages/${chatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: formattedMessage })
    })
    
    input.value = ''
    
    // Force reload by resetting the count
    lastMessageCount[chatId] = 0
    await loadMessages(chatId, withUser, username)
    
  } catch (err) {
    console.error('Error sending message:', err)
    alert('Failed to send message')
  }
}


// Вернуться к списку чатов
function backToChatsList() {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
  showChatsList()
}

// Открыть чат с пользователем (для кнопки "Связаться")
async function openChatWithUser(username) {
  const currentUser = sessionStorage.getItem('username')
  if (!currentUser) return
  
  // Create chat ID
  const participants = [currentUser, username].sort()
  const chatId = participants.join('_')
  
  // Create panel and open it
  createChatsPanel()
  chatsPanel.classList.add('open')
  
  try {
    // Check if chat exists
    let response = await fetch(`/api/chat_messages/${chatId}`)
    let messages = await response.json()
    
    // If chat doesn't exist, create it
    // Better: Don't create dummy messages
if (messages.length === 0) {
  // Chat doesn't exist yet - that's fine, it'll be created on first message
  // Just open the chat without sending anything
}
    
    // FIXED: Pass the friend's username (username), not currentUser
    await openChat(chatId, username)
    
  } catch (err) {
    console.error('Error opening chat:', err)
  }
}

// Check for new messages every 30 seconds
setInterval(async () => {
  if (!isUserLoggedIn()) return
  
  const username = sessionStorage.getItem('username')
  
  try {
    const response = await fetch(`/api/user_chats/${username}`)
    const chats = await response.json()
    
    // For each chat, check if there are new messages
    let totalUnread = 0
    
    for (const chat of chats) {
      const msgResponse = await fetch(`/api/chat_messages/${chat.chatId}`)
      const messages = await msgResponse.json()
      
      const lastCount = lastMessageCount[chat.chatId] || 0
      if (messages.length > lastCount) {
        totalUnread += (messages.length - lastCount)
      }
    }
    
    // Update the notification badge
    if (totalUnread > 0) {
      updateChatNotifications(totalUnread)
    }
    
  } catch (err) {
    console.error('Error checking for new messages:', err)
  }
}, 30000)

// Делаем функции глобальными
window.toggleChatsPanel = toggleChatsPanel
window.openChat = openChat
window.sendMessage = sendMessage
window.backToChatsList = backToChatsList
window.openChatWithUser = openChatWithUser