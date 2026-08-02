// chat.js - Working version with file preview

let chatsPanel = null
let currentChatId = null
let currentChatWith = null
let currentChatWithId = null
let updateInterval = null
let lastMessageCount = {}
let chatSelectedFiles = []
let chatFileTypes = []

async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = (e) => {
            const img = new Image()
            img.src = e.target.result
            img.onload = () => {
                const canvas = document.createElement('canvas')
                let width = img.width
                let height = img.height
                
                // Max dimensions 1200px
                if (width > 1200) {
                    height = (height * 1200) / width
                    width = 1200
                }
                if (height > 1200) {
                    width = (width * 1200) / height
                    height = 1200
                }
                
                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                ctx.drawImage(img, 0, 0, width, height)
                
                canvas.toBlob((blob) => {
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    })
                    resolve(compressedFile)
                }, 'image/jpeg', 0.8) // 80% quality
            }
        }
    })
}

function escapeHtml(str) {
    if (!str) return ''
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

if (!sessionStorage.getItem('userId')) {
    syncFromLocalStorage()
}

async function getUserById(userId) {
    const res = await fetch(`/api/users/${userId}`)
    return res.json()
}

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

function toggleChatsPanel() {
    createChatsPanel()
    if (chatsPanel.classList.contains('open')) {
        chatsPanel.classList.remove('open')
        if (updateInterval) clearInterval(updateInterval)
    } else {
        chatsPanel.classList.add('open')
        showChatsList()
    }
}

async function markChatAsRead(chatId, userId) {
    try {
        const response = await fetch(`/api/chat_messages/${chatId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
        });
        const data = await response.json();
        if (data.success) {
            await updateNotificationCount();
        }
    } catch (err) {
        console.error('Error marking chat as read:', err);
    }
}

function updateFilePreview(chatId) {
    const previewArea = document.getElementById(`chat-preview-${chatId}`)
    if (!previewArea) return
    
    previewArea.innerHTML = ''
    if (chatSelectedFiles.length === 0) {
        previewArea.style.display = 'none'
        return
    }
    
    previewArea.style.display = 'flex'
    
    chatSelectedFiles.forEach((file, idx) => {
        const type = file.type.split('/')[0]
        const previewItem = document.createElement('div')
        previewItem.classList.add('chat-preview-item')
        
        if (type === 'image') {
            const img = document.createElement('img')
            img.classList.add('chat-preview-image')
            img.src = URL.createObjectURL(file)
            previewItem.appendChild(img)
        } else if (type === 'video') {
            const video = document.createElement('video')
            video.src = URL.createObjectURL(file)
            video.controls = true
            previewItem.appendChild(video)
        } else if (type === 'audio') {
            const placeholder = document.createElement('div')
            placeholder.classList.add('audio-placeholder')
            placeholder.textContent = file.name.length > 20 ? file.name.substring(0,17)+'...' : file.name
            previewItem.appendChild(placeholder)
        }
        
        const removeBtn = document.createElement('button')
        removeBtn.textContent = '×'
        removeBtn.classList.add('remove-preview')
        removeBtn.onclick = () => {
            chatSelectedFiles.splice(idx, 1)
            chatFileTypes.splice(idx, 1)
            updateFilePreview(chatId)
        }
        previewItem.appendChild(removeBtn)
        previewArea.appendChild(previewItem)
    })
}

async function showChatsList() {
    const userId = sessionStorage.getItem('userId')
    if (!userId) return
    try {
        const response = await fetch(`/api/user_chats/${userId}`)
        const chats = await response.json()
        chats.sort((a,b) => new Date(b.lastMessageTime||0) - new Date(a.lastMessageTime||0))

        const usersRes = await fetch('/api/users')
        const users = await usersRes.json()
        const userMap = {}
        users.forEach(u => { userMap[u.id] = u.profilePicture })

        let totalUnread = 0
        let html = `<div class="chats-friends-view"><div class="chats-header"><h3>Переписки</h3></div><div class="chats-list">`
        if (chats.length === 0) {
            html += '<div class="no-chats-message">У вас пока нет чатов</div>'
        } else {
            for (const chat of chats) {
                const avatar = userMap[chat.withUserId] || '/default-avatar.jpg'
                const time = chat.lastMessageTime ? new Date(chat.lastMessageTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''
                totalUnread += chat.unreadCount || 0
                html += `
                    <div class="chat-item" onclick="openChat('${chat.chatId}', '${chat.withUser}', ${chat.withUserId})">
                        <img src="${avatar}" class="chat-item-avatar frutiger-aero-border">
                        <div class="chat-item-info">
                            <div class="chat-item-name">${chat.withUser}</div>
                            <div class="chat-item-preview">${chat.lastMessage}</div>
                        </div>
                        <div class="chat-item-time">${time}</div>
                    </div>
                `
            }
        }
        html += '</div></div>'
        chatsPanel.innerHTML = html
        updateChatNotifications(totalUnread)
    } catch (err) {
        console.error('Error loading chats:', err)
    }
}

async function sendMessage(chatId, withUser) {
    const input = document.getElementById(`message-input-${chatId}`)
    const message = input ? input.value.trim() : ''
    const currentUserId = sessionStorage.getItem('userId')
    if (!message && chatSelectedFiles.length === 0) return

    // Store current files before clearing
    const filesToSend = [...chatSelectedFiles]
    const fileTypesToSend = [...chatFileTypes]

    // Clear input and files immediately
    if (input) input.value = ''
    chatSelectedFiles = []
    chatFileTypes = []
    updateFilePreview(chatId)

    // Create temporary message element with unique ID
    const tempId = 'temp_' + Date.now() + '_' + Math.random()
    const container = document.getElementById(`messages-container-${chatId}`)
    
    // Build preview HTML for files
    let filesPreviewHtml = ''
    for (let i = 0; i < filesToSend.length; i++) {
        const file = filesToSend[i]
        const type = fileTypesToSend[i]
        const fileUrl = URL.createObjectURL(file)
        
        if (type === 'image') {
            filesPreviewHtml += `<img src="${fileUrl}" class="chat-attachment-image chat-attachment-pending" onclick="window.openLightbox('${fileUrl}')">`
        } else if (type === 'video') {
            filesPreviewHtml += `<video src="${fileUrl}" controls class="chat-attachment-video chat-attachment-pending"></video>`
        } else if (type === 'audio') {
            filesPreviewHtml += `<audio src="${fileUrl}" controls class="chat-attachment-audio chat-attachment-pending"></audio>`
        }
    }
    
    const tempMessageHtml = `
        <div id="${tempId}" class="message message-mine message-pending" style="opacity: 0.6;">
            ${message ? `<div class="message-text">${escapeHtml(message)}</div>` : ''}
            ${filesPreviewHtml}
            <div class="message-time">Отправляется...</div>
        </div>
    `
    
    // Add temp message to container
    container.insertAdjacentHTML('beforeend', tempMessageHtml)
    container.scrollTop = container.scrollHeight

    // Disable send button temporarily
    const sendBtn = document.getElementById(`send-btn-${chatId}`)
    if (sendBtn) sendBtn.disabled = true

    const { encryptMessage } = await import('./crypto-utils.js')
    
    let encryptedMessage = ''
    if (message) {
        encryptedMessage = await encryptMessage(chatId, message)
    }

    const formData = new FormData()
    formData.append('message', encryptedMessage)
    formData.append('fromUserId', currentUserId)
    formData.append('toUserId', currentChatWithId)
    
    filesToSend.forEach(file => {
        formData.append('files', file)
    })

    try {
        const response = await fetch(`/api/chat_messages/${chatId}`, {
            method: 'POST',
            body: formData
        })
        
        const data = await response.json()
        
        // Remove temp message
        const tempElement = document.getElementById(tempId)
        if (tempElement) tempElement.remove()
        
        if (data.success) {
            // Reload messages to show the real one
            await loadMessages(chatId, withUser, parseInt(currentUserId))
        } else {
            // Show error message
            const errorHtml = `
                <div class="message message-mine message-error" style="opacity: 0.8; border-left: 3px solid red;">
                    ${message ? `<div class="message-text">${escapeHtml(message)}</div>` : ''}
                    ${filesPreviewHtml}
                    <div class="message-time">Не удалось отправить</div>
                    <button onclick="retrySendMessage('${chatId}', '${withUser}', '${message.replace(/'/g, "\\'")}')" style="background: none; border: 1px solid red; border-radius: 4px; margin-top: 4px; cursor: pointer;">↻ Повторить</button>
                </div>
            `
            container.insertAdjacentHTML('beforeend', errorHtml)
            container.scrollTop = container.scrollHeight
            alert('Не удалось отправить сообщение')
        }
    } catch (err) {
        console.error('Error sending message:', err)
        const tempElement = document.getElementById(tempId)
        if (tempElement) tempElement.remove()
        
        // Show error message with retry button
        const errorHtml = `
            <div class="message message-mine message-error" style="opacity: 0.8; border-left: 3px solid red;">
                ${message ? `<div class="message-text">${escapeHtml(message)}</div>` : ''}
                ${filesPreviewHtml}
                <div class="message-time">Ошибка отправки</div>
                <button onclick="retrySendMessage('${chatId}', '${withUser}', '${message.replace(/'/g, "\\'")}')" style="background: none; border: 1px solid red; border-radius: 4px; margin-top: 4px; cursor: pointer;">↻ Повторить</button>
            </div>
        `
        container.insertAdjacentHTML('beforeend', errorHtml)
        container.scrollTop = container.scrollHeight
        alert('Ошибка соединения')
    } finally {
        if (sendBtn) sendBtn.disabled = false
    }
}

// Helper function for retry
function retrySendMessage(chatId, withUser, message) {
    // Restore message to input and resend
    const input = document.getElementById(`message-input-${chatId}`)
    if (input) input.value = message
    sendMessage(chatId, withUser)
}

async function loadMessages(chatId, withUser, currentUserId, isUpdate = false) {
    try {
        const response = await fetch(`/api/chat_messages/${chatId}`)
        const messages = await response.json()
        const container = document.getElementById(`messages-container-${chatId}`)
        if (!container) return

        const currentCount = messages.length
        const prevCount = lastMessageCount[chatId] || 0
        
        // On first load, show loading indicator
        if (!isUpdate && container.innerHTML.includes('Загрузка сообщений')) {
            container.innerHTML = ''
        }
        
        if (isUpdate && currentCount <= prevCount) return

        const { decryptMessage, isEncrypted } = await import('./crypto-utils.js')
        
        let html = ''
        for (const msg of messages) {
            let timestamp, senderId, content
            
            if (typeof msg === 'string') {
                const underscoreIndex = msg.indexOf('_')
                timestamp = msg.substring(0, underscoreIndex)
                const rest = msg.substring(underscoreIndex + 1)
                const colonIndex = rest.indexOf(':')
                senderId = parseInt(rest.substring(0, colonIndex))
                content = rest.substring(colonIndex + 1)
            } else {
                continue
            }
            
            const isMine = senderId === currentUserId
            const time = new Date(timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
            
            let filesHtml = ''
            let textContent = content
            const filesMarker = '|files:'
            const filesIndex = content.indexOf(filesMarker)
            
            if (filesIndex !== -1) {
                const encryptedPart = content.substring(0, filesIndex)
                const filesList = content.substring(filesIndex + filesMarker.length).split(',')
                
                if (encryptedPart && isEncrypted(encryptedPart)) {
                    textContent = await decryptMessage(chatId, encryptedPart)
                } else {
                    textContent = encryptedPart
                }
                
                for (const filePath of filesList) {
                    if (filePath.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                        filesHtml += `<img src="${filePath}" class="chat-attachment-image" onclick="window.openLightbox('${filePath}')">`
                    } else if (filePath.match(/\.(mp4|webm|mov)$/i)) {
                        filesHtml += `<video src="${filePath}" controls class="chat-attachment-video"></video>`
                    } else if (filePath.match(/\.(mp3|wav|ogg)$/i)) {
                        filesHtml += `<audio src="${filePath}" controls class="chat-attachment-audio"></audio>`
                    }
                }
            } else {
                if (isEncrypted(content)) {
                    textContent = await decryptMessage(chatId, content)
                }
            }
            
            html += `
                <div class="message ${isMine ? 'message-mine' : 'message-theirs'}">
                    ${textContent ? `<div class="message-text">${escapeHtml(textContent)}</div>` : ''}
                    ${filesHtml}
                    <div class="message-time">${time}</div>
                </div>
            `
        }
        if (messages.length === 0) html = '<div class="no-messages">Нет сообщений. Напишите что-нибудь!</div>'
        container.innerHTML = html
        container.scrollTop = container.scrollHeight
        lastMessageCount[chatId] = currentCount
        updateNotificationCount()
    } catch (err) {
        console.error('Error loading messages:', err)
        const container = document.getElementById(`messages-container-${chatId}`)
        if (container && !isUpdate) {
            container.innerHTML = '<div class="no-messages" style="color: red;">Ошибка загрузки сообщений</div>'
        }
    }
}

async function openChat(chatId, withUser, withUserId) {
    currentChatId = chatId
    currentChatWith = withUser
    currentChatWithId = withUserId
    const currentUserId = parseInt(sessionStorage.getItem('userId'))
    const panel = document.getElementById('chats-panel')
    
    // Show chat header and loading indicator immediately
    let avatar = '/default-avatar.jpg'
    if (withUserId) {
        const userData = await getUserById(withUserId)
        avatar = userData.profilePicture || '/default-avatar.jpg'
    }

    panel.innerHTML = `
        <div class="chat-view">
            <div class="chat-header">
                <button class="back-to-chats" style="margin-right:-10px; font-size:24px;" onclick="backToChatsList()"><</button>
                <div class="chat-with-info">
                    <img src="${avatar}" class="chat-with-avatar frutiger-aero-border">
                    <span class="chat-with-name"><a class="chat-with-name" href="/profile.html?id=${withUserId}">${withUser}</a></span>
                </div>
            </div>
            <div class="messages-container" id="messages-container-${chatId}">
                <div style="text-align: center; padding: 20px;">Загрузка сообщений...</div>
            </div>
            <div class="chat-preview-area" id="chat-preview-${chatId}" style="display: none; padding: 10px; background: #f5f5f5; border-top: 1px solid #ccc; flex-wrap: wrap; gap: 8px;"></div>
            <div class="message-input-area">
                <textarea id="message-input-${chatId}" placeholder="Написать сообщение..." rows="2"></textarea>
                <div class="message-buttons" style="display:grid; min-width:90px; gap:10px;">
                    <input type="file" id="chat-file-${chatId}" multiple style="display: none;" accept="image/*,video/*,audio/*">
                    <button class="attach-file-btn" style="min-width:90px;" onclick="document.getElementById('chat-file-${chatId}').click()">Прикрепить</button>
                    <button style="min-width:90px;" id="send-btn-${chatId}" onclick="sendMessage('${chatId}', '${withUser}')">Отправить!</button>
                </div>
            </div>
        </div>
    `

    chatSelectedFiles = []
    chatFileTypes = []
    updateFilePreview(chatId)

    document.getElementById(`chat-file-${chatId}`).onchange = (e) => {
        const files = Array.from(e.target.files)
        files.forEach(file => {
            const type = file.type.split('/')[0]
            chatSelectedFiles.push(file)
            chatFileTypes.push(type)
        })
        updateFilePreview(chatId)
        e.target.value = ''
    }

    // Mark as read and load messages in background
    await markChatAsRead(chatId, currentUserId)
    
    // Load messages (will replace the loading indicator)
    await loadMessages(chatId, withUser, currentUserId)

    setTimeout(() => {
        const inp = document.getElementById(`message-input-${chatId}`)
        if (inp) {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(chatId, withUser)
                }
            })
        }
    }, 100)

    if (updateInterval) clearInterval(updateInterval)
    updateInterval = setInterval(() => {
        if (currentChatId === chatId) {
            loadMessages(chatId, withUser, currentUserId, true)
        }
    }, 2000)
}

function backToChatsList() {
    if (updateInterval) clearInterval(updateInterval)
    showChatsList()
}

async function openChatWithUser(userId, username = null) {
    const currentUserId = sessionStorage.getItem('userId')
    if (!currentUserId) return
    
    // If username not provided, fetch it
    let displayName = username
    if (!displayName) {
        const userRes = await fetch(`/api/users/${userId}`)
        const userData = await userRes.json()
        displayName = userData.username
    }
    
    const participants = [parseInt(currentUserId), parseInt(userId)].sort((a,b)=>a-b)
    const chatId = participants.join('_')
    
    createChatsPanel()
    chatsPanel.classList.add('open')
    await openChat(chatId, displayName, parseInt(userId))
}

async function updateNotificationCount() {
    const userId = sessionStorage.getItem('userId')
    if (!userId) return
    try {
        const res = await fetch(`/api/user_chats/${userId}`)
        const chats = await res.json()
        const totalUnread = chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0)
        updateChatNotifications(totalUnread)
    } catch(e) { console.error(e) }
}

function updateChatNotifications(count) {
    const btn = document.getElementById('chats-toggle')
    if (!btn) return
    const existing = btn.querySelector('.notification-badge')
    if (existing) existing.remove()
    if (count > 0) {
        const badge = document.createElement('span')
        badge.classList.add('notification-badge')
        badge.textContent = count
        btn.appendChild(badge)
    }
}

// Passive notification updater - runs every 5 seconds
let notificationInterval = null;

function startNotificationUpdater() {
    if (notificationInterval) clearInterval(notificationInterval);
    notificationInterval = setInterval(() => {
        if (sessionStorage.getItem('userId') && document.hasFocus()) {
            updateNotificationCount();
        }
    }, 5000);
}

function stopNotificationUpdater() {
    if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
    }
}

// Start the updater when the page loads and user is logged in
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('userId')) {
        startNotificationUpdater();
    }
});

// Stop updating when tab is not visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (notificationInterval) {
            clearInterval(notificationInterval);
            notificationInterval = null;
        }
    } else {
        if (sessionStorage.getItem('userId') && !notificationInterval) {
            startNotificationUpdater();
            updateNotificationCount(); // immediate update on visibility
        }
    }
});

// Also restart when user logs in (you can call this from login.js)
window.startNotificationUpdater = startNotificationUpdater;
window.stopNotificationUpdater = stopNotificationUpdater;

window.toggleChatsPanel = toggleChatsPanel
window.openChat = openChat
window.sendMessage = sendMessage
window.backToChatsList = backToChatsList
window.openChatWithUser = openChatWithUser