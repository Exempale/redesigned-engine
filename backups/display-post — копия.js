// display-post.js - Pure function library, no auto-execution

// Store userMap globally within the module
let userMap = {}
let communityMap = {}  // Add this

// Helper function to check if user is admin
function isUserAdmin() {
	return localStorage.getItem('isAdmin') === 'true'
}

function sanitizeHTML(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function sanitizeURL(url) {
  // Remove any javascript: or data: protocols
  const sanitized = url.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
  if (sanitized.toLowerCase().startsWith('javascript:')) return '#'
  if (sanitized.toLowerCase().startsWith('data:')) return '#'
  return sanitized
}

function extractYouTubeId(text) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
    }
    return null;
}

async function fetchYouTubeMetadata(videoId) {
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const data = await response.json();
    return {
        videoId: videoId,
        title: data.title,
        author: data.author_name,
        thumbnail: data.thumbnail_url,
        html: data.html
    };
}

// Initialize user map - call this before displaying posts
export async function loadUserMap() {
  try {
    const usersResponse = await fetch('/api/users')
    const users = await usersResponse.json()
    userMap = {}
    users.forEach(user => {
      userMap[user.id] = user
    })
    
    //const commsResponse = ''//await fetch('/api/communities/all')
    //const communities = await commsResponse.json()
    communityMap = {}
    //communities.forEach(community => {
    //  communityMap[community.id] = community
    //})
    
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
  postDiv.setAttribute('data-post-id', post.id) 
  
  const userData = userMap[post.userId] || {}
  const username = userData.username || 'anonymous'
  const isAnonymous = post.userId === null || post.isAnonymous === true
  const currentUserId = parseInt(localStorage.getItem('userId'))

  const authorSection = document.createElement('div')
  authorSection.classList.add('post-author')

  const authorAuthorSection = document.createElement('div')
  authorAuthorSection.classList.add('author-author-section')

  if (post.community) {
    fetch(`/api/communities/${post.community}`)
      .then(r => r.json())
      .then(communityData => {
        authorAuthorSection.innerHTML = ''
        
        const communityAvatar = document.createElement('img')
        communityAvatar.src = communityData.profilePicture || '/default-avatar.jpg'
        communityAvatar.alt = `${communityData.username}'s avatar`
        communityAvatar.classList.add('community-author-avatar', 'frutiger-aero-border')
        authorAuthorSection.appendChild(communityAvatar)
        
        if (!isAnonymous) {
          const userAvatar = document.createElement('img')
          userAvatar.src = userData.profilePicture || '/default-avatar.jpg'
          userAvatar.alt = username
          userAvatar.classList.add('author-avatar', 'frutiger-aero-border')
          authorAuthorSection.appendChild(userAvatar)
        }
        
        const authorInfo = document.createElement('div')
        authorInfo.classList.add('author-info')
        authorInfo.classList.add('community')
        
        const communityName = document.createElement('a')
        communityName.href = `/community.html?id=${communityData.id}`
        communityName.innerHTML = sanitizeHTML(communityData.username)
        communityName.classList.add(isAnonymous ? 'community-author-name-alone' : 'community-author-name')
        authorInfo.appendChild(communityName)
        
        if (!isAnonymous) {
          const userName = document.createElement('a')
          userName.href = `/profile.html?id=${userData.id}`
          userName.textContent = username
          userName.classList.add('author-name-user')
          authorInfo.appendChild(userName)
        }
        
        const timestampLink = document.createElement('a')
        timestampLink.href = `/post.html?id=${post.id}`
        timestampLink.classList.add('author-timestamp')
        timestampLink.textContent = new Date(post.createdAt).toLocaleString()
        timestampLink.style.cursor = 'pointer'
        timestampLink.style.color = 'inherit'
        authorInfo.appendChild(timestampLink)
        
        authorAuthorSection.appendChild(authorInfo)
      })
      .catch(err => console.error('Error loading community:', err))
  } else {
    const authorAvatar = document.createElement('img')
    authorAvatar.src = userData.profilePicture || '/default-avatar.jpg'
    authorAvatar.alt = username
    authorAvatar.classList.add('author-avatar', 'frutiger-aero-border')
    authorAuthorSection.appendChild(authorAvatar)
    
    const authorInfo = document.createElement('div')
    authorInfo.classList.add('author-info')
    
    const authorName = document.createElement('a')
    authorName.href = `/profile.html?id=${userData.id}`
    authorName.textContent = username
    authorName.classList.add('author-name')
    authorInfo.appendChild(authorName)
    
     const timestampLink = document.createElement('a')
        timestampLink.href = `/post.html?id=${post.id}`
        timestampLink.classList.add('author-timestamp')
        timestampLink.textContent = new Date(post.createdAt).toLocaleString()
        timestampLink.style.cursor = 'pointer'
        timestampLink.style.color = 'inherit'
        authorInfo.appendChild(timestampLink)
    
    authorAuthorSection.appendChild(authorInfo)
  }

  const isPostOwner = currentUserId === post.userId
  const isAdmin = isUserAdmin()
  const postInteractions = document.createElement('span')
  postInteractions.textContent = '▼'
  postInteractions.classList.add('post-interactions')
  
  const postInteractionsTable = document.createElement('div')
  postInteractionsTable.classList.add('post-dropdown')

  if (isPostOwner || isAdmin) {
    if (isPostOwner) {
      const editBtn = document.createElement('button')
      editBtn.textContent = 'Изменить'
      editBtn.classList.add('dropdown-item')
      editBtn.addEventListener('click', function() {
        if (typeof window.enterEditMode === 'function') {
          window.enterEditMode(post, postDiv, onRefreshCallback)
        }
      })
      postInteractionsTable.appendChild(editBtn)
    }
    
    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Удалить'
    deleteBtn.classList.add('dropdown-item')
    deleteBtn.addEventListener('click', function() {
      if (confirm('Delete this post?')) {
        if (typeof window.deletePost === 'function') {
          window.deletePost(post.id, postDiv, onRefreshCallback)
        }
      }
    })
    postInteractionsTable.appendChild(deleteBtn)
  }

  postInteractions.appendChild(postInteractionsTable)
  authorSection.appendChild(authorAuthorSection)
  authorSection.appendChild(postInteractions)
  postDiv.appendChild(authorSection)
  
  // ===== MAIN CONTENT ROW =====
  const contentRow = document.createElement('div')
  contentRow.classList.add('post-content-row')
  
  const mediaItems = []
  
  if (post.imagePath && !post.files) {
    mediaItems.push({ type: 'image', path: post.imagePath })
  } else if (post.files && post.files.length > 0) {
    post.files.forEach((file, index) => {
      const type = post.fileTypes?.[index] || 'image'
      if (type === 'image' || type === 'video') {
        mediaItems.push({ type: type, path: file })
      }
    })
  }
  
  if (mediaItems.length > 0) {
    const carousel = document.createElement('div')
    carousel.classList.add('post-carousel')
    
    const currentMedia = document.createElement('div')
    currentMedia.classList.add('carousel-current')
    
    const updateMediaDisplay = (index) => {
      currentMedia.innerHTML = ''
      const item = mediaItems[index]
      
      if (item.type === 'image') {
        const img = document.createElement('img')
        img.src = item.path
        img.classList.add('carousel-image')
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
    
    let currentIndex = 0
    updateMediaDisplay(0)
    
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
  
  if (post.content) {
  const youtubeId = extractYouTubeId(post.content)
  if (youtubeId && !mediaItems.some(item => item.type === 'youtube' && item.videoId === youtubeId)) {
    fetchYouTubeMetadata(youtubeId).then(ytData => {
      mediaItems.push({
        type: 'youtube',
        videoId: ytData.videoId,
        title: sanitizeHTML(ytData.title),  // Sanitize YouTube title
        thumbnail: ytData.thumbnail,
        embedUrl: `https://www.youtube.com/embed/${ytData.videoId}`
      })
    }).catch(err => console.error('Failed to fetch YouTube metadata:', err))
  }
  const textDiv = document.createElement('div')
  textDiv.classList.add('post-text')
  // SAFE: Sanitize content before linkifying
  const sanitizedContent = sanitizeHTML(post.content)
  textDiv.innerHTML = linkify(sanitizedContent)
  contentRow.appendChild(textDiv)
}
  
  postDiv.appendChild(contentRow)
  
  // AUDIO SECTION
  if (post.files && post.files.length > 0) {
    const audioFiles = post.files.filter((file, index) => {
      const type = post.fileTypes?.[index] || 'image'
      return type === 'audio'
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
  
  // BOTTOM ROW
  const bottomRow = document.createElement('div')
  bottomRow.classList.add('post-bottom-row')
  
  const leftSection = document.createElement('div')
  leftSection.classList.add('post-left-section')
  
  const hasLiked = post.likes && post.likes.includes(currentUserId)
  const likeCount = post.likeCount || post.likes?.length || 0
  
  const likeBtn = document.createElement('button')
  likeBtn.classList.add('postbutton', 'like-button')
  likeBtn.textContent = 'Балл'
  if (hasLiked) likeBtn.classList.add('liked')
  
  const likeCounter = document.createElement('span')
  likeCounter.classList.add('like-counter')
  likeCounter.textContent = likeCount
  
  likeBtn.addEventListener('click', function() {
    if (!currentUserId) {
      window.location.href = '/login.html'
      return
    }
    
    fetch(`/api/posts/${post.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId })
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
  
  const commentCount = document.createElement('span')
  commentCount.classList.add('comment-count-text')
  commentCount.textContent = `Комментариев: ${post.comments?.length || 0}`
  leftSection.appendChild(commentCount)
  
  bottomRow.appendChild(leftSection)
  
  const rightSection = document.createElement('div')
  rightSection.classList.add('post-right-section')
  
  bottomRow.appendChild(rightSection)
  postDiv.appendChild(bottomRow)
  
  const commentsSection = createCommentsSection(post, onRefreshCallback)
  postDiv.appendChild(commentsSection)
  
  return postDiv
}

// Create comments section
function createCommentsSection(post, onRefreshCallback) {
  const commentsSection = document.createElement('div')
  commentsSection.classList.add('comments-section')
  
  const currentUserId = parseInt(localStorage.getItem('userId'))
  const currentUser = userMap[currentUserId]
  
  if (currentUserId) {
    const commentInputDiv = document.createElement('div')
    commentInputDiv.classList.add('comment-input-area')
    
    const currentUserAvatar = document.createElement('img')
    currentUserAvatar.src = currentUser?.profilePicture || '/default-avatar.jpg'
    currentUserAvatar.classList.add('comment-input-avatar', 'frutiger-aero-border')
    
    const inputContainer = document.createElement('div')
    inputContainer.classList.add('comment-input-container')
    
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
    commentInput.style.width = '90%'
    
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
      formData.append('userId', currentUserId)
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
          refreshSinglePost(post.id, onRefreshCallback)
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
  
  if (post.comments && post.comments.length > 0) {
    const commentsList = document.createElement('div');
    commentsList.classList.add('comments-list');

    // 1. Map comments by id
    const commentMap = {};
    post.comments.forEach(comment => {
        commentMap[comment.id] = comment;
        comment.replies = []; // prepare for children
    });

    // 2. Build tree: top‑level comments have no parent (reference == -1 or null)
    const topLevelComments = [];
    post.comments.forEach(comment => {
        const parentId = comment.reference;  // server sends 'reference' field
        if (parentId && parentId !== -1 && commentMap[parentId]) {
            commentMap[parentId].replies.push(comment);
        } else {
            topLevelComments.push(comment);
        }
    });

    // 3. Sort each level by creation date (oldest first)
    function sortCommentsByDate(comments) {
    comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));  // DESC = newest first
    comments.forEach(c => {
        if (c.replies && c.replies.length) sortCommentsByDate(c.replies);
    });
}
    sortCommentsByDate(topLevelComments);

    // 4. Recursive renderer
function renderCommentLevel(comments, parentElement, refreshCallback, postId) {
    comments.forEach(comment => {
        const commentDiv = createCommentElement(comment, postId, 0, refreshCallback);
        parentElement.appendChild(commentDiv);
        
        if (comment.replies && comment.replies.length > 0) {
            const repliesContainer = commentDiv.querySelector('.comment-replies-container');
            if (repliesContainer) {
                //repliesContainer.dataset.replies = JSON.stringify(comment.replies);
                repliesContainer.dataset.loaded = 'false';
                repliesContainer.dataset.parentId = comment.id;
            }
        }
    });
}

    renderCommentLevel(topLevelComments, commentsList, onRefreshCallback, post.id);
    commentsSection.appendChild(commentsList);
}
  
  return commentsSection
}

async function refreshSinglePost(postId, fullRefreshCallback) {
    try {
        const response = await fetch(`/api/posts/${postId}`);
        if (!response.ok) throw new Error('Failed to fetch post');
        const updatedPost = await response.json();
        
        // Find the post element in the DOM by data attribute
        const postElement = document.querySelector(`.post[data-post-id="${postId}"]`);
        if (!postElement) {
            // Post not found in DOM, do full refresh
            if (fullRefreshCallback) fullRefreshCallback();
            return;
        }
        
        // Create new post element with updated data
        const newPostElement = createPostElement(updatedPost, fullRefreshCallback);
        
        // Replace the old element with the new one
        postElement.replaceWith(newPostElement);
        
    } catch (err) {
        console.error('Failed to refresh post:', err);
        // Fallback to full refresh
        if (fullRefreshCallback) fullRefreshCallback();
    }
}

function createCommentElement(comment, postId, depth, onRefreshCallback) {
    const commenterData = userMap[comment.userId] || {};
    const commenterUsername = commenterData.username || 'Unknown';
    const currentUserId = parseInt(localStorage.getItem('userId'));
    
    const commentDiv = document.createElement('div');
    commentDiv.classList.add('comment-item');
    commentDiv.setAttribute('data-comment-id', comment.id);
    
    if (depth > 3) {commentDiv.classList.add('comment-reply-deep')} else if (depth>0) {commentDiv.classList.add('comment-reply')}

    
    const level = Math.min(depth, 3);
    const darkenFactor = level * 10;
    const r = Math.floor(246 - darkenFactor);
    const g = Math.floor(247 - darkenFactor);
    const b = Math.floor(249 - darkenFactor);
    commentDiv.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 1)`;
    
    // --- Header (avatar, author, time) ---
    const commentHeader = document.createElement('div');
    commentHeader.classList.add('comment-header');
    
    const authorInfo = document.createElement('div');
    const authorName = document.createElement('div');
    authorInfo.classList.add('comment-author-info');
    authorName.style.display = 'flex';
    authorName.style.flexDirection = 'column';
    authorName.style.justifyContent = 'flex-start';
    authorName.style.gap = '2px';
    
    const commentAvatar = document.createElement('img');
    commentAvatar.src = commenterData.profilePicture || '/default-avatar.jpg';
    commentAvatar.classList.add('frutiger-aero-border', 'comment-avatar');
    
    const commentAuthor = document.createElement('a');
    commentAuthor.href = `/profile.html?id=${comment.userId}`;
    commentAuthor.textContent = commenterUsername;
    commentAuthor.classList.add('comment-author');
    
    const commentTime = document.createElement('span');
    commentTime.classList.add('comment-time');
    commentTime.textContent = new Date(comment.createdAt).toLocaleString();


    authorName.appendChild(commentAuthor);
    authorName.appendChild(commentTime);

    authorInfo.appendChild(commentAvatar);
    authorInfo.appendChild(authorName);
    
    // Reply reference
    if (comment.reference && comment.reference !== -1) {
    const replyRef = document.createElement('span');
    replyRef.classList.add('reply-reference');
    

    
    const refLink = document.createElement('p');
    refLink.textContent = '→ ' + commenterUsername;
    refLink.style.textDecoration = 'none';
    refLink.style.color = '#2c5282';

    //replyRef.appendChild(refLink);
    //authorInfo.appendChild(replyRef);
}
    

    
    commentHeader.appendChild(authorInfo);
    
    // --- Content ---
    const contentRow = document.createElement('div');
    contentRow.classList.add('comment-content-row');
    
    if (comment.content) {
        const textDiv = document.createElement('div');
        textDiv.classList.add('comment-text');
        textDiv.innerHTML = linkify(sanitizeHTML(comment.content));
        contentRow.appendChild(textDiv);
    }
    
    if (comment.attachment) {
        const attachmentDiv = document.createElement('div');
        attachmentDiv.classList.add('comment-attachment');
        if (comment.attachmentType === 'image') {
            const img = document.createElement('img');
            img.src = comment.attachment;
            img.classList.add('comment-attachment-image');
            img.addEventListener('click', () => window.openLightbox(comment.attachment));
            attachmentDiv.appendChild(img);
        } else if (comment.attachmentType === 'video') {
            const video = document.createElement('video');
            video.src = comment.attachment;
            video.controls = true;
            video.classList.add('comment-attachment-video');
            attachmentDiv.appendChild(video);
        } else if (comment.attachmentType === 'audio') {
            const audio = document.createElement('audio');
            audio.src = comment.attachment;
            audio.controls = true;
            audio.classList.add('comment-attachment-audio');
            attachmentDiv.appendChild(audio);
        }
        contentRow.appendChild(attachmentDiv);
    }
    
    // --- Footer ---
    const commentFooter = document.createElement('div');
    commentFooter.classList.add('comment-footer');
    
    const isCommentOwner = currentUserId === comment.userId;
    const isAdmin = isUserAdmin();
    
    if (isCommentOwner || isAdmin) {
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('comment-delete-btn');
        deleteBtn.innerHTML = 'Удалить';
        deleteBtn.addEventListener('click', () => {
            if (confirm('Удалить комментарий?')) {
                deleteComment(postId, comment.id, commentDiv);
            }
        });
        commentHeader.appendChild(deleteBtn);
    }   
    
    const likeContainer = document.createElement('div');
    likeContainer.classList.add('comment-like-container');
    const likeBtn = document.createElement('button');
    likeBtn.classList.add('comment-like-btn', 'postbutton');
    likeBtn.textContent = 'Да';
    const hasLiked = comment.likes && comment.likes.includes(currentUserId);
    const likeCount = comment.likeCount || comment.likes?.length || 0;
    if (hasLiked) likeBtn.classList.add('liked');
    const likeCounter = document.createElement('span');
    likeCounter.classList.add('comment-like-counter');
    likeCounter.textContent = likeCount;
    likeBtn.addEventListener('click', () => {
        if (!currentUserId) return;
        fetch(`/api/posts/${postId}/comments/${comment.id}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                if (data.liked) likeBtn.classList.add('liked');
                else likeBtn.classList.remove('liked');
                likeCounter.textContent = data.likeCount;
            }
        });
    });

    likeContainer.appendChild(likeBtn);
    likeContainer.appendChild(likeCounter);
    commentFooter.appendChild(likeContainer);
    
    // Reply button
    const replyBtn = document.createElement('button');
    replyBtn.textContent = 'Ответить';
    replyBtn.classList.add('reply-btn');
    
    // Create replies container ONCE
    const repliesContainer = document.createElement('div');
    repliesContainer.classList.add('comment-replies-container');
    repliesContainer.style.display = 'none';
    
    replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existingInput = commentDiv.querySelector('.reply-input-container');
        if (existingInput) existingInput.remove();
        const replyContainer = createReplyInput(comment.id, postId, onRefreshCallback);
        commentDiv.insertBefore(replyContainer, repliesContainer);
        replyBtn.style.display = 'none';
        const observer = new MutationObserver(() => {
            if (!commentDiv.contains(replyContainer)) {
                replyBtn.style.display = 'inline-block';
                observer.disconnect();
            }
        });
        observer.observe(commentDiv, { childList: true });
    });
    commentFooter.appendChild(replyBtn);
    
    commentDiv.appendChild(commentHeader);
    commentDiv.appendChild(contentRow);
    commentDiv.appendChild(commentFooter);

	if (comment.replies && comment.replies.length > 0) {
        let loaded = false;
        
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = `раскрыть`;
        toggleBtn.classList.add('toggle-replies-btn');
        
        toggleBtn.addEventListener('click', async () => {
            const isHidden = repliesContainer.style.display === 'none';
            if (isHidden && !loaded) {
                // Use the replies already in memory (from the comment object)
                comment.replies.forEach(reply => {
                    const replyDiv = createCommentElement(reply, postId, depth + 1, onRefreshCallback);
                    repliesContainer.appendChild(replyDiv);
                });
                loaded = true;
            }
            repliesContainer.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? `скрыть` : `раскрыть`;
        });
        
        commentFooter.appendChild(toggleBtn);
	//commentFooter.classList.add('comment-footer-replies')
	//commentFooter.style.borderBottomStyle = 'solid'
	//commentFooter.style.paddingBottom = '7px'
	//commentFooter.style.borderColor = 'rgba(0,0,0,0.1)'
	//commentFooter.style.borderWidth = '2px'
    }
    
    
    commentDiv.appendChild(repliesContainer);
    
    return commentDiv;
}


function createReplyInput(parentCommentId, postId, onRefreshCallback) {
    const container = document.createElement('div');
    container.classList.add('reply-input-container');
    
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Написать ответ...';
    textarea.classList.add('comment-input');
    textarea.rows = 2;
    textarea.style.resize = 'none';
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*,audio/*';
    fileInput.style.display = 'none';
    
    const attachBtn = document.createElement('button');
    attachBtn.textContent = '📎 Прикрепить';
    attachBtn.classList.add('comment-attach-btn');
    attachBtn.onclick = () => fileInput.click();
    
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Отправить';
    sendBtn.classList.add('comment-button', 'postbutton');
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Отмена';
    cancelBtn.classList.add('cancel-reply-btn');
    cancelBtn.onclick = () => container.remove();
    
    const buttonRow = document.createElement('div');
    buttonRow.classList.add('reply-buttons');
    buttonRow.appendChild(attachBtn);
    buttonRow.appendChild(sendBtn);
    buttonRow.appendChild(cancelBtn);
    
    container.appendChild(textarea);
    container.appendChild(fileInput);
    container.appendChild(buttonRow);
    
    // File preview (optional, similar to comment input)
    const previewContainer = document.createElement('div');
    previewContainer.classList.add('comment-preview-container');
    previewContainer.style.display = 'none';
    container.appendChild(previewContainer);
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Show preview (same as handleCommentFileSelect)
        previewContainer.innerHTML = '';
        const fileType = file.type.split('/')[0];
        if (fileType === 'image') {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            img.classList.add('comment-preview-image');
            previewContainer.appendChild(img);
        } else if (fileType === 'video') {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(file);
            video.controls = true;
            previewContainer.appendChild(video);
        } else if (fileType === 'audio') {
            const audio = document.createElement('audio');
            audio.src = URL.createObjectURL(file);
            audio.controls = true;
            previewContainer.appendChild(audio);
        }
        previewContainer.style.display = 'block';
    });
    
    sendBtn.addEventListener('click', async () => {
        const content = textarea.value.trim();
        const file = fileInput.files[0];
        if (!content && !file) return;
        
        const formData = new FormData();
        formData.append('userId', localStorage.getItem('userId'));
        formData.append('content', content);
        if (file) formData.append('attachment', file);
        formData.append('refId', parentCommentId); // Important: send parent comment ID
        
        try {
            const response = await fetch(`/api/posts/${postId}/comments`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                container.remove();
                // Refresh the whole post to show new reply (or use refreshSinglePost)
                refreshSinglePost(postId, onRefreshCallback);
            } else {
                alert('Ошибка: ' + (data.error || 'Не удалось отправить ответ'));
            }
        } catch (err) {
            console.error('Reply error:', err);
            alert('Ошибка сервера');
        }
    });
    
    return container;
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
  
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  
  // First sanitize the entire text
  let sanitizedText = sanitizeHTML(text)
  
  // Then replace URLs safely
  return sanitizedText.replace(urlRegex, function(url) {
    let href = url
    if (url.startsWith('www.')) {
      href = 'https://' + url
    }
    // Sanitize the URL
    href = sanitizeURL(href)
    // Escape the URL text as well
    const safeUrlText = sanitizeHTML(url)
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #16b0d1; text-decoration: underline;word-break: break-all;">${safeUrlText}</a>`
  })
}
