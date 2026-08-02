// chat.js - Fixed version

let chatsPanel = null
let currentChatId = null
let currentChatWith = null
let currentChatWithId = null
let updateInterval = null
let lastMessageCount = {}

// CHAT FILE HANDLING - separate from post.js
let chatSelectedFiles = []
let chatFileTypes = []

if (!sessionStorage.getItem('userId')) {
    syncFromLocalStorage()
}

async function getUserById(userId) {
    const res = await fetch(`/api/users/${userId}`)
    return res.json()
}

async function getUserByUsername(username) {
    const usersRes = await fetch('/api/users')
    const users = await usersRes.json()
    return users.find(u => u.username === username)
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
        if (updateInterval) {
            clearInterval(updateInterval)
            updateInterval = null
        }
    } else {
        chatsPanel.classList.add('open')
        showChatsList()
    }
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
        users.forEach(u => { userMap[u.username] = u.profilePicture })

        const { decryptMessage, isEncrypted } = await import('./crypto-utils.js')

        let html = `<div class="chats-friends-view"><div class="chats-header"><h3>Переписки</h3></div><div class="chats-list" id="chats-list">`
        if (chats.length === 0) {
            html += '<div class="no-chats-message">У вас пока нет чатов</div>'
        } else {
            for (const chat of chats) {
                const avatar = userMap[chat.withUser] || '/default-avatar.jpg'
                const time = chat.lastMessageTime ? new Date(chat.lastMessageTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''
                
                let preview = chat.lastMessage || 'Нет сообщений'
                if (preview && preview !== 'Нет сообщений') {
                    const colonIndex = preview.indexOf(':')
                    if (colonIndex !== -1) {
                        const encryptedContent = preview.substring(colonIndex + 1)
                        if (isEncrypted(encryptedContent)) {
                            try {
                                const decrypted = await decryptMessage(chat.chatId, encryptedContent)
                                preview = decrypted.substring(0, 30) + (decrypted.length > 30 ? '...' : '')
                            } catch (err) {
                                preview = '[Encrypted]'
                            }
                        }
                    }
                }
                
                html += `
                    <div class="chat-item" onclick="openChat('${chat.chatId}', '${chat.withUser}', ${chat.withUserId || null})">
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
        makeChatsListShrink()
    } catch (err) {
        console.error('Error loading chats:', err)
    }
}

function handleChatFileSelect(event, chatId) {
    const files = Array.from(event.target.files)
    const previewArea = document.getElementById(`chat-preview-${chatId}`)
    if (!previewArea) return
    previewArea.innerHTML = ''
    chatSelectedFiles = []
    chatFileTypes = []

    const newImages = files.filter(f => f.type.startsWith('image/')).length
    const newVideos = files.filter(f => f.type.startsWith('video/')).length
    const newAudios = files.filter(f => f.type.startsWith('audio/')).length
    
    if (newVideos > 0 && (newImages > 0 || newAudios > 0)) { alert('Нельзя смешивать видео с изображениями или аудио'); return }
    if (newVideos > 10) { alert('Максимум 10 видео'); return }
    if (newImages > 10) { alert('Максимум 10 изображений'); return }
    if (newAudios > 3) { alert('Максимум 3 аудиофайла'); return }

    files.forEach((file, idx) => {
        chatSelectedFiles.push(file)
        const type = file.type.split('/')[0]
        chatFileTypes.push(type)
        const previewItem = document.createElement('div')
        previewItem.classList.add('chat-preview-item')
        if (type === 'image') {
            const img = document.createElement('img')
            img.src = URL.createObjectURL(file)
            previewItem.appendChild(img)
        } else if (type === 'video') {
            const video = document.createElement('video')
            video.src = URL.createObjectURL(file)
            video.controls = true
            previewItem.appendChild(video)
        } else if (type === 'audio') {
            const placeholder = document.createElement('div')
            placeholder.textContent = file.name.length > 20 ? file.name.substring(0,17)+'...' : file.name
            previewItem.appendChild(placeholder)
        }
        const removeBtn = document.createElement('button')
        removeBtn.textContent = '×'
        removeBtn.onclick = () => removeChatFile(idx, chatId)
        previewItem.appendChild(removeBtn)
        previewArea.appendChild(previewItem)
    })
    previewArea.style.display = 'flex'
    event.target.value = ''
}

function removeChatFile(index, chatId) {
    chatSelectedFiles.splice(index, 1)
    chatFileTypes.splice(index, 1)
    const previewArea = document.getElementById(`chat-preview-${chatId}`)
    if (!previewArea) return
    previewArea.innerHTML = ''
    chatSelectedFiles.forEach((file, i) => {
        const type = file.type.split('/')[0]
        const previewItem = document.createElement('div')
        previewItem.classList.add('chat-preview-item')
        if (type === 'image') {
            const img = document.createElement('img')
            img.src = URL.createObjectURL(file)
            previewItem.appendChild(img)
        } else if (type === 'video') {
            const video = document.createElement('video')
            video.src = URL.createObjectURL(file)
            video.controls = true
            previewItem.appendChild(video)
        } else if (type === 'audio') {
            const placeholder = document.createElement('div')
            placeholder.textContent = file.name.length > 20 ? file.name.substring(0,17)+'...' : file.name
            previewItem.appendChild(placeholder)
        }
        const removeBtn = document.createElement('button')
        removeBtn.textContent = '×'
        removeBtn.onclick = () => removeChatFile(i, chatId)
        previewItem.appendChild(removeBtn)
        previewArea.appendChild(previewItem)
    })
    if (previewArea.children.length === 0) previewArea.style.display = 'none'
}

async function sendMessage(chatId, withUser) {
    const input = document.getElementById(`message-input-${chatId}`)
    const message = input ? input.value.trim() : ''
    const currentUserId = parseInt(sessionStorage.getItem('userId'))
    const currentUsername = sessionStorage.getItem('username')
    
    if (!message && chatSelectedFiles.length === 0) return

    const timestamp = new Date().toISOString()
    
    // Build the message object (matches server format)
    const messageObj = {
        text: message,
        files: [],
        fileTypes: []
    }
    
    // Handle files
    for (let i = 0; i < chatSelectedFiles.length; i++) {
        const file = chatSelectedFiles[i]
        const type = chatFileTypes[i]
        
        // For now, we'll send files as base64 since the server expects FormData
        // But we're sending JSON, so we need to use FormData in the fetch
        // Actually, let's use FormData for the request
    }

    let toUserId = currentChatWithId
    if (!toUserId) {
        const userData = await getUserByUsername(withUser)
        toUserId = userData?.id
    }

    // Use FormData for file uploads
    const formData = new FormData()
    formData.append('message', message)
    formData.append('fromUserId', currentUserId)
    formData.append('toUserId', toUserId)
    
    chatSelectedFiles.forEach(file => {
        formData.append('files', file)
    })

    try {
        const response = await fetch(`/api/chat_messages/${chatId}`, {
            method: 'POST',  // Changed to POST to match server
            body: formData
        })
        
        const data = await response.json()
        if (data.success) {
            if (input) input.value = ''
            chatSelectedFiles = []
            chatFileTypes = []
            const previewArea = document.getElementById(`chat-preview-${chatId}`)
            if (previewArea) {
                previewArea.innerHTML = ''
                previewArea.style.display = 'none'
            }
            lastMessageCount[chatId] = 0
            await loadMessages(chatId, withUser, currentUserId)
        }
    } catch (err) {
        console.error('Error sending message:', err)
        alert('Failed to send message')
    }
}

async function loadMessages(chatId, withUser, currentUserId, isUpdate = false) {
    try {
        const response = await fetch(`/api/chat_messages/${chatId}`)
        const messages = await response.json()
        const container = document.getElementById(`messages-container-${chatId}`)
        if (!container) return

        const currentCount = messages.length
        const prevCount = lastMessageCount[chatId] || 0
        if (isUpdate && currentCount <= prevCount) return

        const { decryptMessage, isEncrypted } = await import('./crypto-utils.js')
        
        let html = ''
        for (const msg of messages) {
            // Handle new object format from server
            if (typeof msg === 'object' && msg !== null) {
                const isMine = msg.fromUserId === currentUserId
                const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
                
                // Decrypt text if it's encrypted
                let textContent = msg.text || ''
                if (textContent && isEncrypted(textContent)) {
                    textContent = await decryptMessage(chatId, textContent)
                }
                
                // Handle files
                let filesHtml = ''
                if (msg.files && msg.files.length > 0) {
                    for (let i = 0; i < msg.files.length; i++) {
                        const filePath = msg.files[i]
                        const fileType = msg.fileTypes[i]
                        if (fileType === 'image') {
                            filesHtml += `<img src="${filePath}" class="chat-message-attachment chat-attachment-image" onclick="window.openLightbox('${filePath}')">`
                        } else if (fileType === 'video') {
                            filesHtml += `<video src="${filePath}" controls class="chat-message-attachment chat-attachment-video"></video>`
                        } else if (fileType === 'audio') {
                            filesHtml += `<audio src="${filePath}" controls class="chat-message-attachment chat-attachment-audio"></audio>`
                        }
                    }
                }
                
                html += `
                    <div class="message ${isMine ? 'message-mine' : 'message-theirs'}">
                        ${textContent ? `<div class="message-text">${textContent}</div>` : ''}
                        ${filesHtml}
                        <div class="message-time">${time}</div>
                    </div>
                `
            }
            // Handle old string format for backward compatibility
            else if (typeof msg === 'string') {
                const underscoreIndex = msg.indexOf('_')
                const timestamp = msg.substring(0, underscoreIndex)
                const rest = msg.substring(underscoreIndex + 1)
                const colonIndex = rest.indexOf(':')
                const senderId = parseInt(rest.substring(0, colonIndex))
                let content = rest.substring(colonIndex + 1)
                
                const isMine = senderId === currentUserId
                const time = new Date(timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
                
                let textContent = ''
                let filesHtml = ''
                
                const filesMarker = '|files:'
                const filesIndex = content.indexOf(filesMarker)
                if (filesIndex !== -1) {
                    const encryptedPart = content.substring(0, filesIndex)
                    if (isEncrypted(encryptedPart)) {
                        textContent = await decryptMessage(chatId, encryptedPart)
                    }
                    // Files in old format were base64 data, we can't show them now
                } else {
                    if (isEncrypted(content)) {
                        textContent = await decryptMessage(chatId, content)
                    } else {
                        textContent = content
                    }
                }
                
                html += `
                    <div class="message ${isMine ? 'message-mine' : 'message-theirs'}">
                        ${textContent ? `<div class="message-text">${textContent}</div>` : ''}
                        ${filesHtml}
                        <div class="message-time">${time}</div>
                    </div>
                `
            }
        }
        if (messages.length === 0) html = '<div class="no-messages">Нет сообщений. Напишите что-нибудь!</div>'
        container.innerHTML = html
        container.scrollTop = container.scrollHeight
        lastMessageCount[chatId] = currentCount
        await markChatAsRead(chatId)
        updateNotificationCount()
    } catch (err) {
        console.error('Error loading messages:', err)
    }
}

async function openChat(chatId, withUser, withUserId = null) {
    currentChatId = chatId
    currentChatWith = withUser
    currentChatWithId = withUserId
    const currentUserId = parseInt(sessionStorage.getItem('userId'))
    const panel = document.getElementById('chats-panel')

    await markChatAsRead(chatId)

    let avatar = '/default-avatar.jpg'
    if (withUserId) {
        const userData = await getUserById(withUserId)
        avatar = userData.profilePicture || '/default-avatar.jpg'
    } else if (withUser) {
        const userData = await getUserByUsername(withUser)
        avatar = userData?.profilePicture || '/default-avatar.jpg'
    }

    panel.innerHTML = `
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
            <div class="chat-preview-area" id="chat-preview-${chatId}" style="display: none; padding: 10px; background: #f5f5f5; border-top: 1px solid #ccc; flex-wrap: wrap; gap: 8px;"></div>
            <div class="message-input-area">
                <textarea id="message-input-${chatId}" placeholder="Написать сообщение..." rows="2"></textarea>
                <div class="message-buttons">
                    <input type="file" id="chat-file-${chatId}" multiple style="display: none;" accept="image/*,video/*,audio/*" onchange="handleChatFileSelect(event, '${chatId}')">
                    <button class="attach-file-btn" onclick="document.getElementById('chat-file-${chatId}').click()">📎</button>
                    <button onclick="sendMessage('${chatId}', '${withUser}')">Отправить</button>
                </div>
            </div>
        </div>
    `

    chatSelectedFiles = []
    chatFileTypes = []
    loadMessages(chatId, withUser, currentUserId)

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

async function openChatWithUser(username) {
    const currentUserId = parseInt(sessionStorage.getItem('userId'))
    if (!currentUserId) return
    
    const otherUser = await getUserByUsername(username)
    if (!otherUser) {
        console.error('User not found:', username)
        return
    }
    
    const participants = [currentUserId, otherUser.id].sort((a,b)=>a-b)
    const chatId = participants.join('_')
    
    createChatsPanel()
    chatsPanel.classList.add('open')
    
    await openChat(chatId, username, otherUser.id)
}

async function markChatAsRead(chatId) {
    const readKey = `read_${chatId}`
    const read = JSON.parse(localStorage.getItem(readKey) || '[]')
    const currentUserId = parseInt(sessionStorage.getItem('userId'))
    if (!currentUserId) return
    
    const res = await fetch(`/api/chat_messages/${chatId}`)
    const messages = await res.json()
    let changed = false
    
    for (const msg of messages) {
        const msgId = msg.id || msg
        if (typeof msg === 'object') {
            if (msg.fromUserId !== currentUserId && !read.includes(msgId)) {
                read.push(msgId)
                changed = true
            }
        } else if (typeof msg === 'string') {
            const colonIndex = msg.indexOf(':')
            if (colonIndex !== -1) {
                const senderId = parseInt(msg.substring(0, colonIndex).split('_')[1])
                if (senderId !== currentUserId && !read.includes(msg)) {
                    read.push(msg)
                    changed = true
                }
            }
        }
    }
    
    if (changed) {
        localStorage.setItem(readKey, JSON.stringify(read))
        updateNotificationCount()
    }
}

async function updateNotificationCount() {
    const userId = sessionStorage.getItem('userId')
    if (!userId) return
    try {
        const res = await fetch(`/api/user_chats/${userId}`)
        const chats = await res.json()
        let total = 0
        for (const chat of chats) {
            const msgsRes = await fetch(`/api/chat_messages/${chat.chatId}`)
            const msgs = await msgsRes.json()
            const readKey = `read_${chat.chatId}`
            const read = JSON.parse(localStorage.getItem(readKey) || '[]')
            const currentUserId = parseInt(sessionStorage.getItem('userId'))
            
            const unread = msgs.filter(msg => {
                if (typeof msg === 'object') {
                    return msg.fromUserId !== currentUserId && !read.includes(msg.id)
                } else if (typeof msg === 'string') {
                    const colonIndex = msg.indexOf(':')
                    if (colonIndex !== -1) {
                        const senderId = parseInt(msg.substring(0, colonIndex).split('_')[1])
                        return senderId !== currentUserId && !read.includes(msg)
                    }
                }
                return false
            }).length
            total += unread
        }
        updateChatNotifications(total)
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
        badge.textContent = count > 99 ? '99+' : count
        btn.appendChild(badge)
    }
}

function makeChatsListShrink() {
    const list = document.querySelector('.chats-list')
    const panel = document.getElementById('chats-panel')
    if (!list || !panel) return
    const items = list.querySelectorAll('.chat-item')
    if (items.length === 0) { list.style.maxHeight = '200px'; return }
    let total = 0
    items.forEach(i => total += i.offsetHeight)
    total += 20
    const max = window.innerHeight - 200
    list.style.maxHeight = Math.min(total, max) + 'px'
}

setInterval(() => { if (sessionStorage.getItem('userId')) updateNotificationCount() }, 30000)

window.toggleChatsPanel = toggleChatsPanel
window.openChat = openChat
window.sendMessage = sendMessage
window.backToChatsList = backToChatsList
window.openChatWithUser = openChatWithUser
window.handleChatFileSelect = handleChatFileSelect