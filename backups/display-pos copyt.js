// display-post.js - Pure function library, no auto-execution

// Store userMap globally within the module
let userMap = {}
let communityMap = {}  // Add this

// Helper function to check if user is admin
function isUserAdmin() {
  return sessionStorage.getItem('isAdmin') === 'true'
}

// Initialize user map - call this before displaying posts
export async function loadUserMap() {
  try {
    // Load users
    const usersResponse = await fetch('/api/users')
    const users = await usersResponse.json()
    userMap = {}
    users.forEach(user => {
      userMap[user.username] = user
    })
    
    // Load communities
    const commsResponse = await fetch('/api/communities')
    const communities = await commsResponse.json()
    communityMap = {}
    communities.forEach(community => {
      communityMap[community.id] = community
    })
    
    return { userMap, communityMap }
  } catch (err) {
    console.error('Error loading maps:', err)
    return { userMap, communityMap }
  }
}

// Main function to display posts in any container
export function displayPosts(containerId, posts, onRefreshCallback) {
  const container = document.getElementById(containerId)
  if (!container) return
  
  container.innerHTML = ''
  
  if (posts.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px;">Нет постов</div>'
    return
  }
  
  posts.sort((a, b) => b.id - a.id)
  
  posts.forEach(post => {
    const postDiv = createPostElement(post, onRefreshCallback)
    container.appendChild(postDiv)
  })
}

// Create a single post element
function createPostElement(post, onRefreshCallback) {
  const postDiv = document.createElement('div')
  postDiv.classList.add('post')
  
  const userData = userMap[post.username] || {}
  
  // AUTHOR SECTION
const authorSection = document.createElement('div')
authorSection.classList.add('post-author')

// Check if this post belongs to a community
if (post.community) {
  // First, load community data
  fetch(`/api/communities/${post.community}`)
    .then(r => r.json())
    .then(communityData => {
      // Clear existing author section (only if we already added default stuff)
      authorSection.innerHTML = ''
      
      // Community avatar (left, bigger)
      const communityAvatar = document.createElement('img')
      communityAvatar.src = communityData.profilePicture || '/default-avatar.jpg'
      communityAvatar.alt = `${communityData.username}'s avatar`
      communityAvatar.classList.add('community-author-avatar', 'frutiger-aero-border')
      authorSection.appendChild(communityAvatar)
      
      if (!post.isAnonymous){
      // User avatar (right, smaller, overlaps slightly)
      const userAvatar = document.createElement('img')
      userAvatar.src = userData.profilePicture || '/default-avatar.jpg'
      userAvatar.alt = `${post.username}'s avatar`
      userAvatar.classList.add('author-avatar', 'frutiger-aero-border')
      authorSection.appendChild(userAvatar)}
      
      // Info container (name and timestamp)
      const authorInfo = document.createElement('div')
      authorInfo.classList.add('author-info')
      
      // Community name (top, larger)
      const communityName = document.createElement('a')
      communityName.href = `/community.html?id=${communityData.id}`
      communityName.textContent = communityData.username
      if (!post.isAnonymous) {communityName.classList.add('community-author-name')} else {communityName.classList.add('community-author-name-alone')}
      authorInfo.appendChild(communityName)
      
      if (!post.isAnonymous){
      // User name (bottom, smaller)
      const userName = document.createElement('a')
      userName.href = `/profile.html?user=${encodeURIComponent(post.username)}`
      userName.textContent = post.username || 'anonymous'
      userName.classList.add('author-name-user')
      authorInfo.appendChild(userName)}
      
      const timestampLink = document.createElement('a')
timestampLink.href = `/post.html?id=${post.id}`
timestampLink.classList.add('author-timestamp')
timestampLink.textContent = new Date(post.createdAt).toLocaleString()
timestampLink.style.cursor = 'pointer'
timestampLink.style.textDecoration = 'none'
timestampLink.style.color = 'inherit'
authorInfo.appendChild(timestampLink)
      
      authorSection.appendChild(authorInfo)
    })
    .catch(err => console.error('Error loading community avatar:', err))
} else {
  // Regular post (user only)
  const authorAvatar = document.createElement('img')
  authorAvatar.src = userData.profilePicture || '/default-avatar.jpg'
  authorAvatar.alt = `${post.username}'s avatar`
  authorAvatar.classList.add('author-avatar', 'frutiger-aero-border')
  authorSection.appendChild(authorAvatar)

  
  const authorInfo = document.createElement('div')
  authorInfo.classList.add('author-info')
  
  const authorName = document.createElement('a')
  authorName.href = `/profile.html?user=${encodeURIComponent(post.username)}`
  authorName.textContent = post.username || 'anonymous'
  authorName.classList.add('author-name')
  authorInfo.appendChild(authorName)
  
  const timestamp = document.createElement('div')
	timestamp.classList.add('author-timestamp')
	timestamp.textContent = new Date(post.createdAt).toLocaleString()

	// Make it clickable
	timestamp.style.cursor = 'pointer'
	timestamp.addEventListener('click', (e) => {
	  e.stopPropagation()
	  window.location.href = `/post.html?id=${post.id}`
	})

	authorInfo.appendChild(timestamp)
  
  authorSection.appendChild(authorInfo)
}

postDiv.appendChild(authorSection)
  
// ===== MAIN CONTENT ROW (image left, text right) =====
const contentRow = document.createElement('div')
contentRow.classList.add('post-content-row')

// Collect all image and video files
const mediaItems = []

// Handle old format (single imagePath)
if (post.imagePath && !post.files) {
  mediaItems.push({
    type: 'image',
    path: post.imagePath
  })
}
// Handle new format with files array
else if (post.files && post.files.length > 0) {
  post.files.forEach((file, index) => {
    const type = post.fileTypes?.[index] || 'image'
    if (type === 'image' || type === 'video') {
      mediaItems.push({
        type: type,
        path: file
      })
    }
  })
}

// If there are media items, create a carousel
if (mediaItems.length > 0) {
  const carousel = document.createElement('div')
  carousel.classList.add('post-carousel')
  
  // Current media display
  const currentMedia = document.createElement('div')
  currentMedia.classList.add('carousel-current')
  
  // Create the first media element
  const updateMediaDisplay = (index) => {
    currentMedia.innerHTML = ''
    const item = mediaItems[index]
    
    if (item.type === 'image') {
      const img = document.createElement('img')
      img.src = item.path
      img.alt = 'Post image'
      img.classList.add('carousel-image')
      // FIX: Add proper lightbox call with ALL media items
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        if (typeof window.openLightbox === 'function') {
          window.openLightbox(item.path, mediaItems)
        }
      })
      currentMedia.appendChild(img)
    } else if (item.type === 'video') {
      const video = document.createElement('video')
      video.src = item.path
      video.controls = true
      video.classList.add('carousel-video')
      video.preload = 'metadata'
      currentMedia.appendChild(video)
    }
  }
  
  // Initial display
  let currentIndex = 0
  updateMediaDisplay(0)
  
  // Navigation buttons - SQUARE, NOT CIRCLE
  if (mediaItems.length > 1) {
    const prevBtn = document.createElement('button')
    prevBtn.classList.add('carousel-nav', 'carousel-prev')
    prevBtn.innerHTML = '←'
    prevBtn.addEventListener('click', () => {
      currentIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length
      updateMediaDisplay(currentIndex)
      updateCounter()
    })
    
    const nextBtn = document.createElement('button')
    nextBtn.classList.add('carousel-nav', 'carousel-next')
    nextBtn.innerHTML = '→'
    nextBtn.addEventListener('click', () => {
      currentIndex = (currentIndex + 1) % mediaItems.length
      updateMediaDisplay(currentIndex)
      updateCounter()
    })
    
    // Counter
    const counter = document.createElement('div')
    counter.classList.add('carousel-counter')
    const updateCounter = () => {
      counter.textContent = `${currentIndex + 1} / ${mediaItems.length}`
    }
    updateCounter()
    
    carousel.appendChild(prevBtn)
    carousel.appendChild(currentMedia)
    carousel.appendChild(nextBtn)
    carousel.appendChild(counter)
  } else {
    carousel.appendChild(currentMedia)
  }
  
  contentRow.appendChild(carousel)
}

// RIGHT SIDE - Text content
if (post.content) {
  const textDiv = document.createElement('div')
  textDiv.classList.add('post-text')
  textDiv.innerHTML = linkify(post.content)  // Changed from textContent
  contentRow.appendChild(textDiv)
}

postDiv.appendChild(contentRow)

// AUDIO SECTION - separate from carousel, full width
if (post.files && post.files.length > 0) {
  const audioFiles = []
  post.files.forEach((file, index) => {
    const type = post.fileTypes?.[index] || 'image'
    if (type === 'audio') {
      audioFiles.push(file)
    }
  })
  
  if (audioFiles.length > 0) {
    const audioContainer = document.createElement('div')
    audioContainer.classList.add('post-audio-container')
    
    audioFiles.forEach(audioPath => {
      const audio = document.createElement('audio')
      audio.src = audioPath
      audio.controls = true
      audio.classList.add('post-audio')
      audio.preload = 'metadata'
      audioContainer.appendChild(audio)
    })
    
    postDiv.appendChild(audioContainer)
  }
}
  
  // BOTTOM ROW (likes, comments, buttons)
  const bottomRow = document.createElement('div')
  bottomRow.classList.add('post-bottom-row')
  
  // LEFT SECTION - Likes
  const leftSection = document.createElement('div')
  leftSection.classList.add('post-left-section')
  
  const currentUser = sessionStorage.getItem('username')
  const hasLiked = post.likes && post.likes.includes(currentUser)
  const likeCount = post.likeCount || post.likes?.length || 0
  
  const likeBtn = document.createElement('button')
  likeBtn.classList.add('postbutton', 'like-button')
  likeBtn.textContent = 'Балл'
  if (hasLiked) likeBtn.classList.add('liked')
  
  const likeCounter = document.createElement('span')
  likeCounter.classList.add('like-counter')
  likeCounter.textContent = likeCount
  
  likeBtn.addEventListener('click', function() {
    const username = sessionStorage.getItem('username')
    if (!username) {
      
      return
    }
    
    fetch(`/api/posts/${post.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        if (data.liked) {
          likeBtn.classList.add('liked')
        } else {
          likeBtn.classList.remove('liked')
        }
        likeCounter.textContent = data.likeCount
      }
    })
  })
  
  leftSection.appendChild(likeBtn)
  leftSection.appendChild(likeCounter)
  
  // Comment count
  const commentCount = document.createElement('span')
  commentCount.classList.add('comment-count-text')
  commentCount.textContent = `Комментариев: ${post.comments?.length || 0}`
  leftSection.appendChild(commentCount)
  
  bottomRow.appendChild(leftSection)
  
  // RIGHT SECTION - Post action buttons
  const rightSection = document.createElement('div')
  rightSection.classList.add('post-right-section')

  const isPostOwner = currentUser === post.username
  const isAdmin = isUserAdmin()

  if (isPostOwner || isAdmin) {
    if (isPostOwner) {
      const editBtn = document.createElement('button')
      editBtn.textContent = 'Изменить'
      editBtn.classList.add('delete-btn')
      editBtn.addEventListener('click', function() {
        if (typeof window.enterEditMode === 'function') {
          window.enterEditMode(post, postDiv, onRefreshCallback)
        }
      })
      rightSection.appendChild(editBtn)
    }
    
    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Удалить'
    deleteBtn.classList.add('delete-btn')
    deleteBtn.addEventListener('click', function() {
      if (confirm('Delete this post?')) {
        if (typeof window.deletePost === 'function') {
          window.deletePost(post.id, postDiv, onRefreshCallback)
        }
      }
    })
    rightSection.appendChild(deleteBtn)
  }

  bottomRow.appendChild(rightSection)
  postDiv.appendChild(bottomRow)
  
  // COMMENTS SECTION
  const commentsSection = createCommentsSection(post, onRefreshCallback)
  postDiv.appendChild(commentsSection)
  
  return postDiv
}

// Create comments section
function createCommentsSection(post, onRefreshCallback) {
  const commentsSection = document.createElement('div')
  commentsSection.classList.add('comments-section')
  
  const currentUsername = sessionStorage.getItem('username')
  
  // Comment input area
  if (currentUsername) {
    const commentInputDiv = document.createElement('div')
    commentInputDiv.classList.add('comment-input-area')
    
    const currentUserAvatar = document.createElement('img')
    currentUserAvatar.src = userMap[currentUsername]?.profilePicture || '/default-avatar.jpg'
    currentUserAvatar.classList.add('comment-input-avatar', 'frutiger-aero-border')
    
    const inputContainer = document.createElement('div')
    inputContainer.classList.add('comment-input-container')
    
    // Preview area
    const previewContainer = document.createElement('div')
    previewContainer.classList.add('comment-preview-container')
    previewContainer.id = `comment-preview-${post.id}`
    previewContainer.style.display = 'none'
    
    const previewContent = document.createElement('div')
    previewContent.classList.add('comment-preview-content')
    
    const removePreviewBtn = document.createElement('button')
    removePreviewBtn.classList.add('comment-preview-remove')
    removePreviewBtn.innerHTML = '✕'
    removePreviewBtn.onclick = function() { clearCommentAttachment(post.id) }
    
    previewContainer.appendChild(previewContent)
    previewContainer.appendChild(removePreviewBtn)
    
    const commentInput = document.createElement('textarea')
    commentInput.placeholder = 'Написать комментарий...'
    commentInput.classList.add('comment-input')
    commentInput.rows = 2
    commentInput.style.resize = 'none'
    
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.id = `comment-file-${post.id}`
    fileInput.accept = 'image/*,video/*,audio/*'
    fileInput.style.display = 'none'
    fileInput.addEventListener('change', function(e) { handleCommentFileSelect(e, post.id) })
    
    const commentButtons = document.createElement('div')
    commentButtons.classList.add('comment-buttons')
    
    const attachBtn = document.createElement('button')
    attachBtn.classList.add('comment-attach-btn')
    attachBtn.innerHTML = 'Прикрепить файл'
    attachBtn.onclick = function() { fileInput.click() }
    
    const commentButton = document.createElement('button')
    commentButton.textContent = 'Отправить'
    commentButton.classList.add('comment-button', 'postbutton')
    
    commentButton.addEventListener('click', function() {
      const content = commentInput.value.trim()
      const file = fileInput.files[0]
      
      if (!content && !file) return
      
      const formData = new FormData()
      formData.append('username', currentUsername)
      formData.append('content', content)
      if (file) formData.append('attachment', file)
      
      fetch(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          commentInput.value = ''
          clearCommentAttachment(post.id)
          if (onRefreshCallback) onRefreshCallback()
        }
      })
    })
    
    commentButtons.appendChild(attachBtn)
    commentButtons.appendChild(commentButton)
    
    inputContainer.appendChild(previewContainer)
    inputContainer.appendChild(commentInput)
    inputContainer.appendChild(fileInput)
    inputContainer.appendChild(commentButtons)
    
    commentInputDiv.appendChild(currentUserAvatar)
    commentInputDiv.appendChild(inputContainer)
    commentsSection.appendChild(commentInputDiv)
  }
  
  // Display existing comments
if (post.comments && post.comments.length > 0) {
  const commentsList = document.createElement('div')
  commentsList.classList.add('comments-list')
  
  const sortedComments = [...post.comments].sort(function(a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt)
  })
  
  // Check if we're on a single post page
  const isPostPage = window.location.pathname.includes('post.html')
  
  // Show all comments on post page, otherwise show only 2
  const initialCount = isPostPage ? sortedComments.length : Math.min(sortedComments.length, 2)
  const hasMore = !isPostPage && sortedComments.length > 2
    
    const visibleContainer = document.createElement('div')
    visibleContainer.classList.add('visible-comments')
    
    for (let i = 0; i < initialCount; i++) {
      const commentDiv = createCommentElement(sortedComments[i], post.id)
      visibleContainer.appendChild(commentDiv)
    }
    
    commentsList.appendChild(visibleContainer)
    
    if (hasMore) {
      const showAllContainer = document.createElement('div')
      showAllContainer.classList.add('show-all-comments-container')
      
      const lineWithButton = document.createElement('div')
      lineWithButton.classList.add('line-with-button')
      
      const showAllBtn = document.createElement('button')
      showAllBtn.textContent = `Показать все (${sortedComments.length - 2})`
      showAllBtn.classList.add('show-all-comments-btn')
      lineWithButton.appendChild(showAllBtn)
      
      const hiddenContainer = document.createElement('div')
      hiddenContainer.classList.add('hidden-comments')
      hiddenContainer.style.display = 'none'
      
      for (let i = 2; i < sortedComments.length; i++) {
        const commentDiv = createCommentElement(sortedComments[i], post.id)
        hiddenContainer.appendChild(commentDiv)
      }
      
      showAllBtn.addEventListener('click', function() {
        hiddenContainer.style.display = 'block'
        showAllContainer.style.display = 'none'
      })
      
      showAllContainer.appendChild(lineWithButton)
      commentsList.appendChild(showAllContainer)
      commentsList.appendChild(hiddenContainer)
    }
    
    commentsSection.appendChild(commentsList)
  }
  
  return commentsSection
}

// Create a single comment element
function createCommentElement(comment, postId) {
  const commentDiv = document.createElement('div')
  commentDiv.classList.add('comment-item')
  
  const commentHeader = document.createElement('div')
  commentHeader.classList.add('comment-header')
  
  const authorInfo = document.createElement('div')
  authorInfo.classList.add('comment-author-info')
  
  const commentAvatar = document.createElement('img')
  commentAvatar.src = userMap[comment.username]?.profilePicture || '/default-avatar.jpg'
  commentAvatar.classList.add('comment-avatar', 'frutiger-aero-border')
  
  const commentAuthor = document.createElement('a')
  commentAuthor.href = `/profile.html?user=${encodeURIComponent(comment.username)}`
  commentAuthor.textContent = comment.username
  commentAuthor.classList.add('comment-author')
  
  authorInfo.appendChild(commentAvatar)
  authorInfo.appendChild(commentAuthor)
  
  const commentTime = document.createElement('span')
  commentTime.classList.add('comment-time')
  commentTime.textContent = new Date(comment.createdAt).toLocaleString()
  
  commentHeader.appendChild(authorInfo)
  commentHeader.appendChild(commentTime)
  
  const contentRow = document.createElement('div')
  contentRow.classList.add('comment-content-row')
  
  if (comment.content) {
    const textDiv = document.createElement('div')
    textDiv.classList.add('comment-text')
    textDiv.textContent = comment.content
    contentRow.appendChild(textDiv)
  }
  
  if (comment.attachment) {
    const attachmentDiv = document.createElement('div')
    attachmentDiv.classList.add('comment-attachment')
    
    if (comment.attachmentType === 'image') {
      const img = document.createElement('img')
      img.src = comment.attachment
      img.classList.add('comment-attachment-image')
      img.addEventListener('click', function() {
        if (typeof window.openLightbox === 'function') {
          window.openLightbox(comment.attachment)
        }
      })
      attachmentDiv.appendChild(img)
    } else if (comment.attachmentType === 'video') {
      const video = document.createElement('video')
      video.src = comment.attachment
      video.controls = true
      video.classList.add('comment-attachment-video')
      attachmentDiv.appendChild(video)
    } else if (comment.attachmentType === 'audio') {
      const audio = document.createElement('audio')
      audio.src = comment.attachment
      audio.controls = true
      audio.classList.add('comment-attachment-audio')
      attachmentDiv.appendChild(audio)
    }
    
    contentRow.appendChild(attachmentDiv)
  }
  
  const commentFooter = document.createElement('div')
  commentFooter.classList.add('comment-footer')

  const currentUser = sessionStorage.getItem('username')
  const isCommentOwner = currentUser === comment.username
  const isAdmin = isUserAdmin()

  // Delete button (comment owners AND admins can delete comments)
  if (isCommentOwner || isAdmin) {
    const deleteBtn = document.createElement('button')
    deleteBtn.classList.add('comment-delete-btn')
    deleteBtn.innerHTML = 'Удалить комментарий'
    deleteBtn.addEventListener('click', function() {
      if (confirm('Удалить комментарий?')) {
        deleteComment(postId, comment.id, commentDiv)
      }
    })
    commentFooter.appendChild(deleteBtn)
  }

  // Like button (for everyone)
  const likeContainer = document.createElement('div')
  likeContainer.classList.add('comment-like-container')

  const likeBtn = document.createElement('button')
  likeBtn.classList.add('comment-like-btn', 'postbutton')
  likeBtn.textContent = 'Да'

  const hasLiked = comment.likes && comment.likes.includes(currentUser)
  const likeCount = comment.likeCount || comment.likes?.length || 0

  if (hasLiked) likeBtn.classList.add('liked')

  const likeCounter = document.createElement('span')
  likeCounter.classList.add('comment-like-counter')
  likeCounter.textContent = likeCount

  likeBtn.addEventListener('click', function() {
    if (!currentUser) return
    fetch(`/api/posts/${postId}/comments/${comment.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        if (data.liked) likeBtn.classList.add('liked')
        else likeBtn.classList.remove('liked')
        likeCounter.textContent = data.likeCount
      }
    })
  })

  likeContainer.appendChild(likeBtn)
  likeContainer.appendChild(likeCounter)
  commentFooter.appendChild(likeContainer)
  
  commentDiv.appendChild(commentHeader)
  commentDiv.appendChild(contentRow)
  commentDiv.appendChild(commentFooter)
  
  return commentDiv
}

// Helper functions
function handleCommentFileSelect(event, postId) {
  const file = event.target.files[0]
  if (!file) return
  
  const previewContainer = document.getElementById(`comment-preview-${postId}`)
  const previewContent = previewContainer.querySelector('.comment-preview-content')
  
  previewContent.innerHTML = ''
  
  const fileType = file.type.split('/')[0]
  
  if (fileType === 'image') {
    const img = document.createElement('img')
    img.src = URL.createObjectURL(file)
    img.classList.add('comment-preview-image')
    previewContent.appendChild(img)
  } else if (fileType === 'video') {
    const video = document.createElement('video')
    video.src = URL.createObjectURL(file)
    video.controls = true
    video.classList.add('comment-preview-video')
    previewContent.appendChild(video)
  } else if (fileType === 'audio') {
    const audio = document.createElement('audio')
    audio.src = URL.createObjectURL(file)
    audio.controls = true
    audio.classList.add('comment-preview-audio')
    previewContent.appendChild(audio)
  }
  
  previewContainer.style.display = 'block'
}

function clearCommentAttachment(postId) {
  const fileInput = document.getElementById(`comment-file-${postId}`)
  const previewContainer = document.getElementById(`comment-preview-${postId}`)
  
  if (fileInput) fileInput.value = ''
  if (previewContainer) {
    previewContainer.style.display = 'none'
    const content = previewContainer.querySelector('.comment-preview-content')
    if (content) content.innerHTML = ''
  }
}

function deleteComment(postId, commentId, commentElement) {
  fetch(`/api/posts/${postId}/comments/${commentId}`, {
    method: 'DELETE'
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      commentElement.remove()
    } else {
      alert('Failed to delete comment')
    }
  })
  .catch(err => console.error('Error deleting comment:', err))
}

// Helper function to convert URLs in text to clickable links
function linkify(text) {
  if (!text) return ''
  
  // URL regex - matches http://, https://, and www. links
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  
  return text.replace(urlRegex, function(url) {
    let href = url
    // Add https:// if it's a www. link without protocol
    if (url.startsWith('www.')) {
      href = 'https://' + url
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #16b0d1; text-decoration: underline;">${url}</a>`
  })
}
