// post.js - Universal post creator that works on both main.html and community.html

let selectedFiles = []
let fileTypes = []

// Detect which page we're on
const isCommunityPage = window.location.pathname.includes('community.html')
const isProfilePage = window.location.pathname.includes('profile.html')
const isMainPage = window.location.pathname === '/' || window.location.pathname.includes('main.html')

function togglePreviewVisibility() {
    const previewArea = document.getElementById('files-preview-area')
    if (previewArea && previewArea.children.length === 0) {
        previewArea.style.display = 'none'
    } else if (previewArea) {
        previewArea.style.display = 'flex'
    }
}

function initializePostCreator() {
    const userId = sessionStorage.getItem('userId')
    if (!userId) return
    
    // Set up file selection
    const fileSelectBtn = document.getElementById('file-select-btn')
    const postFiles = document.getElementById('post-files')
    
    if (fileSelectBtn && postFiles) {
        fileSelectBtn.addEventListener('click', () => {
            postFiles.click()
        })
        postFiles.addEventListener('change', handleFileSelect)
    }
    
    // Set up post button
    const postButton = document.getElementById('post-button')
    if (postButton) {
        const newPostButton = postButton.cloneNode(true)
        postButton.parentNode.replaceChild(newPostButton, postButton)
        newPostButton.addEventListener('click', createPost)
    }
    
    // Set up enter key
    const postInput = document.getElementById('post-input')
    if (postInput) {
        postInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const btn = document.getElementById('post-button')
                if (btn) btn.click()
            }
        })
    }
    
    // Set up paste support for images
    setupPasteSupport()
    
    // Only initialize page-specific features
    if (isMainPage) {
        initializeMainPagePostCreator()
    }
}

function initializeMainPagePostCreator() {
    const userId = sessionStorage.getItem('userId')
    const username = sessionStorage.getItem('username')
    
    // Set user info for main page
    const creatorAvatar = document.getElementById('creator-avatar')
    const creatorUsername = document.getElementById('creator-username')
    
    if (creatorAvatar) {
        let avatar = '/default-avatar.jpg'
        const checkAvatar = sessionStorage.getItem('userAvatar')
        if (checkAvatar) {
            avatar = checkAvatar
        }
        creatorAvatar.src = avatar
    }
    
    if (creatorUsername) {
        creatorUsername.textContent = username
    }
    
    loadUserCommunities(userId)
}

function setupPasteSupport() {
  const postInput = document.getElementById('post-input')
  if (!postInput) return
  
  postInput.addEventListener('paste', async (e) => {
    const items = e.clipboardData.items
    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault()
        
        const file = item.getAsFile()
        const fileName = `pasted-image-${Date.now()}.png`
        const imageFile = new File([file], fileName, { type: file.type })
        
        selectedFiles.push(imageFile)
        const type = 'image'
        fileTypes.push(type)
        
        const previewArea = document.getElementById('files-preview-area')
        if (!previewArea) return
        
        const previewItem = document.createElement('div')
        previewItem.classList.add('preview-item', 'image-preview')
        
        const img = document.createElement('img')
        img.src = URL.createObjectURL(imageFile)
        previewItem.appendChild(img)
        
        const removeBtn = document.createElement('button')
        removeBtn.classList.add('remove-file')
        removeBtn.innerHTML = '×'
        removeBtn.dataset.index = selectedFiles.length - 1
        removeBtn.addEventListener('click', removeFile)
        
        previewItem.appendChild(removeBtn)
        previewArea.appendChild(previewItem)
        
        togglePreviewVisibility()
        
        const fileInput = document.getElementById('post-files')
        if (fileInput) {
          fileInput.style.border = '2px solid green'
          setTimeout(() => {
            fileInput.style.border = ''
          }, 1000)
        }
        
        break
      }
    }
  })
}

async function loadUserCommunities(userId) {
    try {
        // Get user data to get subscribed community IDs
        const userResponse = await fetch(`/api/users/${userId}`)
        const userData = await userResponse.json()
        const subscribedIds = userData.communities || []
        
        if (subscribedIds.length === 0) {
            console.log('No communities found')
            return
        }
        
        // Get ALL communities data
        const commsResponse = await fetch('/api/communities/all')
        const allComms = await commsResponse.json()
        
        // Filter: only communities user is subscribed to AND can post in
        const canPostIn = allComms.filter(comm => {
            if (!subscribedIds.includes(comm.id)) return false
            
            if (comm.type === 'community') return true
            
            if (comm.type === 'page') {
                const isModerator = comm.moderators?.includes(parseInt(userId))
                const isOwner = comm.owner === parseInt(userId)
                return isModerator || isOwner
            }
            
            return false
        })
        
        const dropdown = document.getElementById('creator-community')
        if (dropdown) {
            canPostIn.forEach(comm => {
                const option = document.createElement('option')
                option.value = comm.id
                option.textContent = comm.username
                dropdown.appendChild(option)
            })
        }
        
    } catch (err) {
        console.error('Error loading communities:', err)
    }
}

function handleFileSelect(event) {
    const files = Array.from(event.target.files)
    const previewArea = document.getElementById('files-preview-area')
    if (!previewArea) return
    
    const newImages = files.filter(f => f.type.startsWith('image/')).length
    const newVideos = files.filter(f => f.type.startsWith('video/')).length
    const newAudios = files.filter(f => f.type.startsWith('audio/')).length
    
    const totalImages = fileTypes.filter(t => t === 'image').length + newImages
    const totalVideos = fileTypes.filter(t => t === 'video').length + newVideos
    const totalAudios = fileTypes.filter(t => t === 'audio').length + newAudios
    
    if (totalVideos > 0 && (totalImages > 0 || totalAudios > 0)) {
        alert('Нельзя смешивать видео с изображениями или аудио')
        return
    }
    
    if (totalVideos > 10) {
        alert('Максимум 10 видео')
        return
    }
    
    if (totalImages > 10) {
        alert('Максимум 10 изображений')
        return
    }
    
    if (totalAudios > 3) {
        alert('Максимум 3 аудиофайла')
        return
    }
    
    files.forEach(file => {
        selectedFiles.push(file)
        const type = file.type.split('/')[0]
        fileTypes.push(type)
        
        const previewItem = document.createElement('div')
        previewItem.classList.add('preview-item')
        
        if (type === 'image') {
            previewItem.classList.add('image-preview')
            const img = document.createElement('img')
            img.src = URL.createObjectURL(file)
            previewItem.appendChild(img)
        } else if (type === 'video') {
            previewItem.classList.add('video-preview')
            const video = document.createElement('video')
            video.src = URL.createObjectURL(file)
            video.controls = true
            previewItem.appendChild(video)
        } else if (type === 'audio') {
            previewItem.classList.add('audio-preview')
            const placeholder = document.createElement('div')
            placeholder.classList.add('audio-placeholder')
            placeholder.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name
            previewItem.appendChild(placeholder)
        }
        
        const removeBtn = document.createElement('button')
        removeBtn.classList.add('remove-file')
        removeBtn.innerHTML = '×'
        removeBtn.dataset.index = selectedFiles.length - 1
        removeBtn.addEventListener('click', removeFile)
        
        previewItem.appendChild(removeBtn)
        previewArea.appendChild(previewItem)
    })
    
    togglePreviewVisibility()
    event.target.value = ''
}

function removeFile(event) {
    const index = event.target.dataset.index
    selectedFiles.splice(index, 1)
    fileTypes.splice(index, 1)
    
    const previewArea = document.getElementById('files-preview-area')
    if (!previewArea) return
    
    previewArea.innerHTML = ''
    
    selectedFiles.forEach((file, i) => {
        const type = file.type.split('/')[0]
        
        const previewItem = document.createElement('div')
        previewItem.classList.add('preview-item')
        
        if (type === 'image') {
            previewItem.classList.add('image-preview')
            const img = document.createElement('img')
            img.src = URL.createObjectURL(file)
            previewItem.appendChild(img)
        } else if (type === 'video') {
            previewItem.classList.add('video-preview')
            const video = document.createElement('video')
            video.src = URL.createObjectURL(file)
            video.controls = true
            previewItem.appendChild(video)
        } else if (type === 'audio') {
            previewItem.classList.add('audio-preview')
            const placeholder = document.createElement('div')
            placeholder.classList.add('audio-placeholder')
            placeholder.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name
            previewItem.appendChild(placeholder)
        }
        
        const removeBtn = document.createElement('button')
        removeBtn.classList.add('remove-file')
        removeBtn.innerHTML = '×'
        removeBtn.dataset.index = i
        removeBtn.addEventListener('click', removeFile)
        
        previewItem.appendChild(removeBtn)
        previewArea.appendChild(previewItem)
    })
    
    togglePreviewVisibility()
}

async function createPost() {
    const content = document.getElementById('post-input').value.trim()
    const userId = sessionStorage.getItem('userId')
    
    if (!content && selectedFiles.length === 0) {
        return
    }
    
    let community = ''
    let isAnonymous = false
    
    if (isCommunityPage) {
        const urlParams = new URLSearchParams(window.location.search)
        community = urlParams.get('id')
        const anonymousCheckbox = document.getElementById('anonymous-post')
        isAnonymous = anonymousCheckbox ? anonymousCheckbox.checked : false
    } else {
        const communityDropdown = document.getElementById('creator-community')
        community = communityDropdown ? communityDropdown.value : ''
        const anonymousToggle = document.getElementById('anonymous-toggle')
        isAnonymous = anonymousToggle ? anonymousToggle.checked : false
    }
    
    const formData = new FormData()
    formData.append('content', content)
    formData.append('userId', userId)  // Send userId, not username
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
            const previewArea = document.getElementById('files-preview-area')
            if (previewArea) previewArea.innerHTML = ''
            togglePreviewVisibility()
            
            if (isCommunityPage && typeof loadCommunity === 'function') {
                loadCommunity()
            } else if (typeof loadAndDisplayPosts === 'function') {
                loadAndDisplayPosts()
            } else if (typeof loadProfile === 'function') {
                loadProfile()
            }
        }
    } catch (err) {
        console.error('Error creating post:', err)
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('userId')) {
        initializePostCreator()
    }
})