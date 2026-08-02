// display-post.js - Pure function library, no auto-execution

// Store userMap globally within the module
let userMap = {}
let communityMap = {}  // Add this
let userMapPromise = null

if (!window.__fortportPostDropdownDelegation) {
  window.__fortportPostDropdownDelegation = true
  document.addEventListener('click', () => {
    document.querySelectorAll('.post-dropdown').forEach(dropdown => {
      dropdown.style.display = 'none'
    })
  })
}

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

export function appendPosts(containerId, posts, onRefreshCallback) {
  const container = document.getElementById(containerId)
  if (!container) return
  
  if (posts.length === 0) return
  
  // Sort posts by ID (newest first)
  //posts.sort((a, b) => b.id - a.id)
  
  // Create each post element and append to container
  posts.forEach(post => {
    const postDiv = createPostElement(post, onRefreshCallback)
    container.appendChild(postDiv)
  })
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
export async function loadUserMap(options = {}) {
  if (userMapPromise && !options.force) return userMapPromise

  userMapPromise = (async () => {
    try {
      const usersResponse = await fetch('/api/users', { credentials: 'same-origin' })
      if (!usersResponse.ok) throw new Error('Failed to load users')
      const users = await usersResponse.json()
      userMap = {}
      users.forEach(user => {
        userMap[user.id] = user
      })
      communityMap = {}
      return { userMap, communityMap }
    } catch (err) {
      userMapPromise = null
      console.error('Error loading maps:', err)
      return { userMap, communityMap }
    }
  })()

  return userMapPromise
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
  
  //posts.sort((a, b) => b.id - a.id)
  
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
  const isSpoiler = post.spoiler
  const isNsfw = post.nsfw
  const spoilerPreview = post.spoilerPreview
  const currentUserId = parseInt(localStorage.getItem('userId'))

  const debugShower = document.createElement('p')
  debugShower.innerHTML = `is spoiler: ${isSpoiler}
is nsfw: ${isNsfw}
spoiler preview: "${spoilerPreview}"`
  debugShower.style.position = 'absolute'
  debugShower.style.background = 'black'
  debugShower.style.color = 'lime'
  debugShower.style.zIndex = '1000'
  debugShower.style.top = '-20px'
  debugShower.style.right = '-190px'
  debugShower.style.padding = '10px'
  debugShower.style.borderRadius = '5px'
  debugShower.style.whiteSpace = 'pre'
  //postDiv.appendChild(debugShower)

  const authorSection = document.createElement('div')
  authorSection.classList.add('post-author')

  if (post.isPinned) {
    postDiv.classList.add('post-pinned')
    const pinnedBadge = document.createElement('span')
    pinnedBadge.className = 'post-pinned-badge'
    pinnedBadge.textContent = 'Закреплено'
    pinnedBadge.setAttribute('aria-label', 'Пост закреплён в профиле')
    postDiv.appendChild(pinnedBadge)
  }

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
        communityName.href = `/community?id=${communityData.id}`
        communityName.innerHTML = sanitizeHTML(communityData.username)
        communityName.classList.add(isAnonymous ? 'community-author-name-alone' : 'community-author-name')
        authorInfo.appendChild(communityName)
        
        if (!isAnonymous) {
          const userName = document.createElement('a')
          userName.href = `/profile?id=${userData.id}`
          userName.textContent = username
          userName.classList.add('author-name-user')
          window.FortPortRoles?.applyName(userName, { ...userData, ...post, id: post.userId || userData.id })
          const userIdentity = document.createElement('span')
          userIdentity.className = 'role-identity-line'
          userIdentity.appendChild(userName)
          const roleBadge = window.FortPortRoles?.createBadge({ ...userData, ...post, id: post.userId || userData.id })
          if (roleBadge) userIdentity.appendChild(roleBadge)
          authorInfo.appendChild(userIdentity)
        }
        
        const timestampLink = document.createElement('a')
        timestampLink.href = `/post?id=${post.id}`
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
    authorName.href = `/profile?id=${userData.id}`
    authorName.textContent = username
    authorName.classList.add('author-name')
    window.FortPortRoles?.applyName(authorName, { ...userData, ...post, id: post.userId || userData.id })
    const authorIdentity = document.createElement('span')
    authorIdentity.className = 'role-identity-line'
    authorIdentity.appendChild(authorName)
    const roleBadge = window.FortPortRoles?.createBadge({ ...userData, ...post, id: post.userId || userData.id })
    if (roleBadge) authorIdentity.appendChild(roleBadge)
    authorInfo.appendChild(authorIdentity)
    
     const timestampLink = document.createElement('a')
        timestampLink.href = `/post?id=${post.id}`
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

// Initially hide the dropdown
postInteractionsTable.style.display = 'none'

if (isPostOwner || isAdmin) {
  if (isPostOwner) {
    const editBtn = document.createElement('button')
    editBtn.textContent = 'Изменить'
    editBtn.classList.add('dropdown-item')
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation()
      postInteractionsTable.style.display = 'none'
      if (typeof window.enterEditMode === 'function') {
        window.enterEditMode(post, postDiv, onRefreshCallback)
      }
    })
    postInteractionsTable.appendChild(editBtn)
  }
  
  const deleteBtn = document.createElement('button')
  deleteBtn.textContent = 'Удалить'
  deleteBtn.classList.add('dropdown-item')
  deleteBtn.addEventListener('click', function(e) {
    e.stopPropagation()
    postInteractionsTable.style.display = 'none'
    if (confirm('Delete this post?')) {
      if (typeof window.deletePost === 'function') {
        window.deletePost(post.id, postDiv, onRefreshCallback)
      }
    }
  })
  postInteractionsTable.appendChild(deleteBtn)
}

const flagBtn = document.createElement('button');
flagBtn.textContent = 'Пожаловаться';
flagBtn.classList.add('dropdown-item');
flagBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    postInteractionsTable.style.display = 'none';
    openFlagModal(post.id);
});
postInteractionsTable.appendChild(flagBtn);

// Toggle dropdown when clicking the ▼ button
postInteractions.addEventListener('click', function(e) {
  e.stopPropagation()
  const isVisible = postInteractionsTable.style.display === 'block'
  postInteractionsTable.style.display = isVisible ? 'none' : 'block'
})

// Prevent dropdown from closing when clicking inside it.
// A single delegated document listener below handles outside clicks for all posts.
postInteractionsTable.addEventListener('click', function(e) {
  e.stopPropagation()
})

postInteractions.appendChild(postInteractionsTable)
authorSection.appendChild(authorAuthorSection)
authorSection.appendChild(postInteractions)
  postDiv.appendChild(authorSection)
  
  // ===== MAIN CONTENT ROW =====
  const contentRowContainer = document.createElement('div')
  contentRowContainer.classList.add('content-row-container')
  const contentRow = document.createElement('div')
  contentRow.classList.add('post-content-row')
  
  const mediaItems = []
  
  if (post.imagePath && !post.files) {
    const pathPhotoId = String(post.imagePath).match(/^\/photo\/(\d+)/)?.[1]
    mediaItems.push({
      type: 'image',
      path: post.imagePath,
      mediaId: post.imageId || (pathPhotoId ? Number(pathPhotoId) : null)
    })
  } else if (post.files && post.files.length > 0) {
    post.files.forEach((file, index) => {
      const type = post.fileTypes?.[index] || 'image'
      if (type === 'image' || type === 'gif' || type === 'video') {
        const pathPhotoId = String(file).match(/^\/photo\/(\d+)/)?.[1]
        mediaItems.push({
          type,
          path: file,
          mediaId: post.fileIds?.[index] || (pathPhotoId ? Number(pathPhotoId) : null)
        })
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
    
    if (item.type === 'image' || item.type === 'gif') {
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
const textDiv = document.createElement('div');
textDiv.classList.add('post-text');
// Get the raw content as text (safe, no HTML injection)
const rawContent = post.content || '';
// Linkify the plain text - this returns HTML where URLs are <a> tags
const linkedContent = linkify(rawContent);
textDiv.innerHTML = linkedContent;
// Preserve line breaks
textDiv.style.whiteSpace = 'pre-wrap';
contentRow.appendChild(textDiv);
    
    // YouTube detection still works separately (it looks at the original post.content string)
    const youtubeId = extractYouTubeId(post.content);
    if (youtubeId && !mediaItems.some(item => item.type === 'youtube' && item.videoId === youtubeId)) {
        fetchYouTubeMetadata(youtubeId).then(ytData => {
            mediaItems.push({
                type: 'youtube',
                videoId: ytData.videoId,
                title: sanitizeHTML(ytData.title),
                thumbnail: ytData.thumbnail,
                embedUrl: `https://www.youtube.com/embed/${ytData.videoId}`
            });
        }).catch(err => console.error('Failed to fetch YouTube metadata:', err));
    }
}

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
        const audioItem = document.createElement("div")
        audioItem.classList.add('post-audio-item')

        const playButton = document.createElement("button")
        playButton.classList.add("post-audio-play-button")

        const playIcon = document.createElement("img")
        playIcon.classList.add("post-audio-play-icon")
        playIcon.src = "/ui/icons/play.webp"
        playButton.appendChild(playIcon)

        const downloadButton = document.createElement("button")
        downloadButton.classList.add("post-audio-download-button")
        downloadButton.textContent = "⬇"

        const addButton = document.createElement("button")
        addButton.classList.add("post-audio-add-button")
        addButton.textContent = "+"

        const volumeContainer = document.createElement("div")
        volumeContainer.classList.add("post-audio-volume")

        const volumeIcon = document.createElement("img")
        volumeIcon.classList.add("post-audio-volume-icon")
        volumeIcon.src = "/ui/icons/volume.webp"
        volumeContainer.appendChild(volumeIcon)

        const volumeSlider = document.createElement("input")
        volumeSlider.classList.add("post-audio-volume-slider")
        volumeSlider.type = "range"
        volumeSlider.min = "0"
        volumeSlider.max = "1"
        volumeSlider.step = "0.01"
        volumeSlider.value = "0.8"
        volumeSlider.style.backgroundSize = "80% 100%"
        volumeContainer.appendChild(volumeSlider)

        const actions = document.createElement("div")
        actions.classList.add("post-audio-actions")
        actions.appendChild(volumeContainer)

        actions.appendChild(downloadButton)
        actions.appendChild(addButton)

        const progressContainer = document.createElement("div")
        progressContainer.classList.add("post-audio-progress-container")

        const currentTime = document.createElement("span")
        currentTime.classList.add("post-audio-current-time")
        currentTime.innerText = "0:00"
        progressContainer.appendChild(currentTime)


        const progressBar = document.createElement("input")
        progressBar.type = "range"
        progressBar.min = "0"
        progressBar.max = "100"
        progressBar.value = "0"
        progressBar.classList.add("post-audio-progress-bar")
        progressContainer.appendChild(progressBar)

        const player = document.createElement("div")
        player.classList.add("post-audio-player")
        player.appendChild(progressContainer)



        const duration = document.createElement("span")
        duration.classList.add("post-audio-duration")
        duration.innerText = "0:00"
        progressContainer.appendChild(duration)



        const audioInfo = document.createElement("div")
        audioInfo.classList.add("post-audio-info")

        const audioName = document.createElement("div")
        audioName.classList.add("post-audio-name")
        audioInfo.appendChild(audioName)

        const audioArtist = document.createElement("div")
        audioArtist.classList.add("post-audio-artist")
        audioInfo.appendChild(audioArtist)

        const audioTop = document.createElement("div")
        audioTop.classList.add("post-audio-top")
        audioTop.appendChild(audioInfo)
        audioTop.appendChild(actions)



        const match = audioPath.match(/\/audio\/(\d+)/)
        const audioId = match ? match[1] : null

        playButton.addEventListener("click", e => {
          e.stopPropagation()
          if (audio.paused) {
            audio.play()
            playIcon.src = '/ui/icons/pause.webp'
          } else {
            audio.pause()
            playIcon.src = '/ui/icons/play.webp'
          }
        })

        addButton.addEventListener('click', () => {
          fetch(`/api/users/audios/${audioId}`, {
            method: 'POST',
            credentials: "same-origin"
          })
            .catch(err => {
              console.error('Error adding to library:', err);
            })
        })




        const audio = document.createElement('audio')
        audio.src = audioPath
        audio.controls = false
        audio.classList.add('post-audio')
        audio.preload = 'metadata'


        volumeSlider.addEventListener("input", (e) => {
          volumeSlider.style.backgroundSize = `${e.target.value * 100}% 100%`
          audio.volume = e.target.value
        })

        progressBar.addEventListener("input", (e) => {
          if (!audio.duration) return

          const percent = e.target.value

          audio.currentTime = audio.duration * (percent / 100)
          progressBar.style.backgroundSize = `${percent}% 100%`
        })

        downloadButton.addEventListener('click', () => {
          const link = document.createElement('a');
          link.href = audioPath;
          link.download = (audio.dataset.audioName || 'audio') + '.mp3';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        })


        fetch(`api/audio/${audioId}`, {
          method: 'GET',
          credentials: "same-origin"
        })
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            audioName.textContent = data.name
            audioArtist.textContent = data.artistName
            audio.dataset.artistName = data.artistName
            audio.dataset.audioName = data.name
          })

        audio.addEventListener("timeupdate", () => {
          if (!audio.duration) return

          const percent = audio.currentTime / audio.duration * 100
          progressBar.style.backgroundSize = `${percent}% 100%`

          progressBar.value = percent

          currentTime.innerText = `${Math.floor(audio.currentTime / 60)}:${Math.floor(audio.currentTime % 60).toString().padStart(2, "0")}`
        })

        audio.addEventListener('loadedmetadata', () => duration.innerText = `${Math.floor(audio.duration / 60)}:${Math.floor(audio.duration % 60).toString().padStart(2, "0")}`)

        audioItem.appendChild(player)
        audioItem.appendChild(audioTop)
        player.appendChild(audio)
        player.appendChild(playButton)
        player.appendChild(progressContainer)

        audioContainer.appendChild(audioItem)
      })

      contentRow.appendChild(audioContainer)
    }
  }


  
  if (isSpoiler == true || isNsfw == true || isSpoiler == 1 || isNsfw == 1) {
	contentRow.classList.add('spoiler-content')
	const spoilerPlaque = document.createElement('div')
        spoilerPlaque.classList.add('spoiler-plaque')
	const spoilerContents = document.createElement('div')
        spoilerContents.classList.add('spoiler-contents')
	const spoilerOpen = document.createElement('button')
	spoilerOpen.textContent = 'Показать спойлер'
	spoilerOpen.classList.add('spoiler-open')
	const spoilerText = document.createElement('div')
        spoilerText.classList.add('spoiler-text')
	if (spoilerPreview !== '') {spoilerText.textContent = '"'+spoilerPreview+'"'} else {spoilerText.style.display='none'}

	if (isNsfw == 1) {
		const nsfwText = document.createElement('div')
		if (isSpoiler == true && spoilerPreview !== '') {nsfwText.classList.add('nsfw-text-secondary')} else {nsfwText.classList.add('nsfw-text')}
		nsfwText.textContent = 'Материал 18+'
		spoilerContents.appendChild(nsfwText)
		}
	spoilerContents.appendChild(spoilerText)
	spoilerContents.appendChild(spoilerOpen)
	spoilerPlaque.appendChild(spoilerContents)
	contentRowContainer.appendChild(spoilerPlaque)

	spoilerOpen.addEventListener('click', () => {
	contentRow.classList.remove('spoiler-content')
	spoilerContents.style.display = 'none'
	spoilerPlaque.classList = ''
})

	spoilerPlaque.appendChild(contentRow)
} else {
contentRowContainer.appendChild(contentRow)
}



  postDiv.appendChild(contentRowContainer)
  
  // POLLS
  if (post.poll) {
    const pollRow = document.createElement('div');
    pollRow.classList.add('post-poll-row');
    
    // Check if user has voted
    const hasVoted = post.poll.choices.some(choice => !!choice.userVoted);
    const isMultiChoice = post.poll.multiChoice == 1;
    
    let choicesHTML = '';
    post.poll.choices.forEach((choice, index) => {
        const votePercent = hasVoted ? (post.poll.totalVotes > 0 ? Math.round((choice.votes / post.poll.totalVotes) * 100) : 0) : 0;
        const isSelected = !!choice.userVoted;
        choicesHTML += `
            <div class="post-poll-choice ${isSelected ? 'selected voted' : ''}" data-choice-id="${choice.id}" onclick="addVote(${post.poll.id}, ${choice.id}, ${post.poll.multiChoice})">
                <span class="poll-choice-text">${sanitizeHTML(choice.text)}</span>
                ${hasVoted ? `<span class="poll-choice-percent">${votePercent}%</span>` : ''}
                ${hasVoted ? `<div class="poll-choice-bar" style="width: ${votePercent}%"></div>` : ''}
                ${isSelected ? `<span class="poll-choice-check">✔</span>` : ''}
            </div>
        `;
    });
    
    let multiChoiceText = '' 
    if (isMultiChoice == 1) {multiChoiceText = 'Множественный выбор' }
    
    pollRow.innerHTML = `
        <div class="post-poll-container">
            <h2>${sanitizeHTML(post.poll.title)}</h2>
            <h5 style="text-align:center; font-weight:normal; color:#555; margin:0 0 8px 0; font-size:14px;">${multiChoiceText}</h5>
            ${post.poll.expiresAt ? `<div class="poll-expires">До: ${new Date(post.poll.expiresAt * 1000).toLocaleString()}</div>` : ''}
            <div class="post-poll-choices-container" id="poll-${post.poll.id}" data-multichoice="${isMultiChoice}">
                ${choicesHTML}
            </div>
            <div style="display:flex; align-items:center; gap:12px; justify-content:flex-start; flex-wrap:wrap;">
                ${hasVoted ? 
                    `<button class="poll-vote-btn" disabled style="opacity:0.6; cursor:default;">Голос учтён</button>` :
                    `<button class="poll-vote-btn" onclick="castVote(${post.poll.id})">Проголосовать!</button>`
                }
                ${hasVoted ? 
                    `<button class="poll-undo-btn" onclick="undoVote(${post.poll.id})">Отменить голос</button>` : 
                    ''
                }
            </div>
            <span class="poll-total-votes">Всего голосов: ${post.poll.totalVotes}</span>
        </div>
    `;
    
    postDiv.appendChild(pollRow);
}

  
  // BOTTOM ROW
  const bottomRow = document.createElement('div')
  bottomRow.classList.add('post-bottom-row')
  
  const leftSection = document.createElement('div')
  leftSection.classList.add('post-left-section')
  
  const hasLiked = post.likes && post.likes.includes(currentUserId)
  const hasDisLiked = post.dislikes && post.dislikes.includes(currentUserId)
  const likeCount = post.likeCount || post.likes?.length || 0
  const dislikeCount = post.dislikeCount || post.dislikes?.length || 0
  
    const likeBtn = document.createElement('button')
  likeBtn.classList.add('like-button')
  likeBtn.textContent = '+ Балл'
  if (hasLiked) likeBtn.classList.add('liked')

  const dislikeBtn = document.createElement('button')
  dislikeBtn.classList.add('dislike-button')
  dislikeBtn.textContent = '- Балл'
  if (hasDisLiked) dislikeBtn.classList.add('disliked')
  
  const likeCounter = document.createElement('span')
likeCounter.classList.add('like-counter')
const netScore = likeCount - dislikeCount
likeCounter.textContent = netScore

// Add tooltip with hover
let tooltipTimeout
likeCounter.addEventListener('mouseenter', () => {
    // Create tooltip
    const tooltip = document.createElement('div')
    tooltip.classList.add('like-tooltip')
    tooltip.textContent = `+${likeCount} Баллов / -${dislikeCount} Баллов`
    tooltip.style.position = 'absolute'
    tooltip.style.background = 'rgba(0,0,0,0.85)'
    tooltip.style.color = 'white'
    tooltip.style.padding = '6px 12px'
    tooltip.style.borderRadius = '6px'
    tooltip.style.fontSize = '13px'
    tooltip.style.pointerEvents = 'none'
    tooltip.style.whiteSpace = 'nowrap'
    tooltip.style.zIndex = '1000'
    tooltip.style.bottom = '100%'
    tooltip.style.left = '50%'
    tooltip.style.transform = 'translateX(-50%)'
    tooltip.style.marginBottom = '6px'
    
    likeCounter.style.position = 'relative'
    likeCounter.appendChild(tooltip)
    
    clearTimeout(tooltipTimeout)
})

likeCounter.addEventListener('mouseleave', () => {
    tooltipTimeout = setTimeout(() => {
        const tooltip = likeCounter.querySelector('.like-tooltip')
        if (tooltip) tooltip.remove()
    }, 100)
})
  
  likeBtn.addEventListener('click', function() {
    if (!currentUserId) {
      window.location.href = '/login'
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
        if (data.disliked) {
          dislikeBtn.classList.add('disliked')
        } else {
          dislikeBtn.classList.remove('disliked')
        }
        likeCounter.textContent = data.likeCount - data.dislikeCount
      }
    })
  })

  dislikeBtn.addEventListener('click', function() {
    if (!currentUserId) {
      window.location.href = '/login'
      return
    }
    
    fetch(`/api/posts/${post.id}/dislike`, {
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
        if (data.disliked) {
          dislikeBtn.classList.add('disliked')
        } else {
          dislikeBtn.classList.remove('disliked')
        }
        likeCounter.textContent = data.likeCount - data.dislikeCount
      }
    })
  })
  
  leftSection.appendChild(likeBtn)
  leftSection.appendChild(likeCounter)
  leftSection.appendChild(dislikeBtn)
  
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

async function undoVote(pollId) {
    const currentUserId = parseInt(localStorage.getItem('userId'));
    if (!currentUserId) {
        alert('Войдите, чтобы отменить голос');
        return;
    }
    
    const container = document.getElementById(`poll-${pollId}`);
    if (!container) return;
    
    // Get all choices the user voted on
    const votedChoices = container.querySelectorAll('.post-poll-choice.voted');
    if (votedChoices.length === 0) {
        alert('Вы ещё не голосовали');
        return;
    }
    
    // Remove votes one by one (or send all at once)
    const choiceIds = Array.from(votedChoices).map(el => parseInt(el.dataset.choiceId));
    
    try {
        // Send DELETE request for each vote
        // Alternatively, your server could accept a batch DELETE
        let success = true;
        for (const choiceId of choiceIds) {
            const response = await fetch('/api/polls/vote', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ choiceId })
            });
            const data = await response.json();
            if (!data.success) {
                success = false;
                break;
            }
        }
        
        if (success) {
            // Refresh the poll by fetching the post again
            const pollRow = container.closest('.post-poll-row');
            if (pollRow) {
                // Find the post ID from the post element
                const postElement = pollRow.closest('.post[data-post-id]');
                if (postElement) {
                    const postId = postElement.dataset.postId;
                    refreshSinglePost(postId, () => {});
                }
            }
        } else {
            alert('Ошибка при отмене голоса');
        }
    } catch (err) {
        console.error('Undo vote error:', err);
        alert('Ошибка сервера');
    }
};

function addVote(pollId, choiceId, multiChoice) {
    const choiceElement = document.querySelector(`.post-poll-choice[data-choice-id="${choiceId}"]`);
    if (!choiceElement) return;
    
    // Check if user has already voted on this poll (button disabled)
    const container = document.getElementById(`poll-${pollId}`);
    if (!container) return;
    
    const voteBtn = container.closest('.post-poll-container').querySelector('.poll-vote-btn');
    if (voteBtn && voteBtn.disabled) {
        // Already voted - do nothing
        return;
    }
    
    if (multiChoice) {
        // Toggle selected class
        choiceElement.classList.toggle('selected');
        // Toggle checkmark
        const check = choiceElement.querySelector('.poll-choice-check');
        if (check) {
            if (choiceElement.classList.contains('selected')) {
                check.style.display = 'inline-block';
            } else {
                check.style.display = 'none';
            }
        }
    } else {
        const allChoices = container.querySelectorAll('.post-poll-choice');
        allChoices.forEach(c => {
            c.classList.remove('selected');
            const check = c.querySelector('.poll-choice-check');
            if (check) check.style.display = 'none';
        });
        
        if (!choiceElement.classList.contains('selected')) {
            choiceElement.classList.add('selected');
            const check = choiceElement.querySelector('.poll-choice-check');
            if (check) check.style.display = 'inline-block';
        }
    }
};

async function castVote(pollId) {
    const currentUserId = parseInt(localStorage.getItem('userId'));
    if (!currentUserId) {
        alert('Войдите, чтобы голосовать');
        return;
    }
    
    const container = document.getElementById(`poll-${pollId}`);
    if (!container) return;
    
    const selectedChoices = container.querySelectorAll('.post-poll-choice.selected');
    if (selectedChoices.length === 0) {
        alert('Выберите вариант');
        return;
    }
    
    // Read multiChoice from data attribute
    const isMultiChoice = container.dataset.multichoice === 'true';
    const choiceIds = Array.from(selectedChoices).map(el => parseInt(el.dataset.choiceId));
    
    try {
        const response = await fetch('/api/polls/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ choiceIds })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            alert('Ошибка: ' + (data.error || 'Не удалось проголосовать'));
            return;
        }
        
        const pollRow = container.closest('.post-poll-row');
        if (!pollRow) return;
        
        const totalSpan = pollRow.querySelector('.poll-total-votes');
        if (totalSpan) totalSpan.textContent = `Всего голосов: ${data.totalVotes}`;
        
        const allChoiceElements = container.querySelectorAll('.post-poll-choice');
        allChoiceElements.forEach(choiceEl => {
            const choiceId = parseInt(choiceEl.dataset.choiceId);
            const choiceData = data.choices.find(c => c.id === choiceId);
            if (!choiceData) return;
            
            const percent = data.totalVotes > 0 ? Math.round((choiceData.votes / data.totalVotes) * 100) : 0;
            
            let percentSpan = choiceEl.querySelector('.poll-choice-percent');
            if (!percentSpan) {
                percentSpan = document.createElement('span');
                percentSpan.className = 'poll-choice-percent';
                choiceEl.appendChild(percentSpan);
            }
            percentSpan.textContent = percent + '%';
            
            let bar = choiceEl.querySelector('.poll-choice-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'poll-choice-bar';
                choiceEl.appendChild(bar);
            }
            bar.style.width = percent + '%';
            
            if (choiceData.userVoted) {
                choiceEl.classList.add('voted', 'selected');
                let check = choiceEl.querySelector('.poll-choice-check');
                if (!check) {
                    check = document.createElement('span');
                    check.className = 'poll-choice-check';
                    check.textContent = '✔';
                    choiceEl.appendChild(check);
                }
                check.style.display = 'inline-block';
            } else {
                choiceEl.classList.remove('voted', 'selected');
                const check = choiceEl.querySelector('.poll-choice-check');
                if (check) check.style.display = 'none';
            }
            
            choiceEl.style.cursor = 'default';
            choiceEl.onclick = null;
        });
        
        // Replace vote button with disabled one
        const voteBtn = pollRow.querySelector('.poll-vote-btn');
        if (voteBtn) {
            const newBtn = document.createElement('button');
            newBtn.className = 'poll-vote-btn';
            newBtn.textContent = 'Голос учтён';
            newBtn.disabled = true;
            newBtn.style.opacity = '0.6';
            newBtn.style.cursor = 'default';
            voteBtn.parentNode.replaceChild(newBtn, voteBtn);
        }
        
        // Add undo button if not present
        let undoBtn = pollRow.querySelector('.poll-undo-btn');
        if (!undoBtn) {
            const btnContainer = pollRow.querySelector('.post-poll-container > div:last-child');
            if (btnContainer) {
                undoBtn = document.createElement('button');
                undoBtn.className = 'poll-undo-btn';
                undoBtn.textContent = 'Отменить голос';
                undoBtn.onclick = function() { undoVote(pollId); };
                btnContainer.appendChild(undoBtn);
            }
        }
        
        // Remove selected class
        container.querySelectorAll('.post-poll-choice.selected').forEach(c => c.classList.remove('selected'));
        
    } catch (err) {
        console.error('Vote error:', err);
        alert('Ошибка сервера');
    }
}

// Create comments section
function createCommentsSection(post, onRefreshCallback) {
  const commentsSection = document.createElement('div')
  commentsSection.classList.add('comments-section')
  
  const currentUserId = parseInt(localStorage.getItem('userId'))
  const currentUser = userMap[currentUserId]
  
  // Comment input (stays the same)
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
    commentInput.style.width = '100%'
    
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.id = `comment-file-${post.id}`
    fileInput.accept = 'image/*,video/*,audio/*'
    fileInput.style.display = 'none'
    fileInput.addEventListener('change', function(e) { handleCommentFileSelect(e, post.id) })

    // ADD PASTE SUPPORT HERE
commentInput.addEventListener('paste', async (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            
            const file = item.getAsFile();
            const fileName = `pasted-image-${Date.now()}.png`;
            const imageFile = new File([file], fileName, { type: file.type });
            
            // Feed to the file input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(imageFile);
            fileInput.files = dataTransfer.files;
            
            // Trigger change event to show preview
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);
            
            // Visual feedback
            commentInput.style.border = '2px solid green';
            setTimeout(() => {
                commentInput.style.border = '';
            }, 1000);
            
            break;
        }
    }
});
    
    const commentButtons = document.createElement('div')
    commentButtons.classList.add('comment-buttons')
    
    const attachBtn = document.createElement('button')
attachBtn.classList.add('comment-attach-btn')
attachBtn.innerHTML = 'Прикрепить'
attachBtn.onclick = function(e) { 
    e.preventDefault();
    e.stopPropagation();
    
    // Remove any existing dropdown
    const existing = document.querySelector('.comment-media-dropdown');
    if (existing) existing.remove();
    
    const rect = attachBtn.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'comment-media-dropdown';
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.background = 'white';
    dropdown.style.border = '2px solid #8FDADB';
    dropdown.style.borderRadius = '12px';
    dropdown.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    dropdown.style.padding = '8px 0';
    dropdown.style.minWidth = '160px';
    dropdown.style.zIndex = '9999';
    
    const options = [
        { type: 'photo', label: 'Фотография' },
        { type: 'video', label: 'Видеозапись' },
        { type: 'audio', label: 'Аудиозапись' },
        { type: 'gif', label: 'GIF' }
    ];
    
    options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'comment-media-dropdown-item';
        item.textContent = opt.label;
        item.style.padding = '10px 20px';
        item.style.cursor = 'pointer';
        item.style.transition = 'background 0.15s';
        item.style.fontSize = '14px';
        item.onmouseenter = () => item.style.background = '#f0f0f0';
        item.onmouseleave = () => item.style.background = 'transparent';
        
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.remove();
            
            //const previewContainer = container.querySelector('.comment-preview-container');
            if (!previewContainer) return;
            
            const onSelect = function(fileData) {
                if (fileData.file) {
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(fileData.file);
                    fileInput.files = dataTransfer.files;
                    const changeEvent = new Event('change', { bubbles: true });
                    fileInput.dispatchEvent(changeEvent);
                    textarea.focus();
                } else if (fileData.path) {
                    previewContainer.innerHTML = '';
                    
                    if (fileData.type === 'image') {
                        const img = document.createElement('img');
                        img.src = fileData.path;
                        img.classList.add('comment-preview-image');
                        previewContainer.appendChild(img);
                    } else if (fileData.type === 'video') {
                        const video = document.createElement('video');
                        video.src = fileData.path;
                        video.controls = true;
                        previewContainer.appendChild(video);
                    } else if (fileData.type === 'audio') {
                        const audio = document.createElement('audio');
                        audio.src = fileData.path;
                        audio.controls = true;
                        previewContainer.appendChild(audio);
                    }
                    
                    previewContainer.style.display = 'block';
                    fileInput.dataset.existingPath = fileData.path;
                    fileInput.dataset.existingType = fileData.type;
                }
            };
            
            openCommentLibraryPicker(post.id, opt.type, fileInput, previewContainer, onSelect);
        });
        
        dropdown.appendChild(item);
    });
    
    document.body.appendChild(dropdown);
    
    // Close dropdown when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target) && e.target !== attachBtn) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 10);
}
    
    const commentButton = document.createElement('button')
    commentButton.textContent = 'Отправить'
    commentButton.classList.add('comment-button', 'postbutton')
    
    commentButton.addEventListener('click', function() {
    const content = commentInput.value.trim()
    const file = fileInput.files[0]
    const existingPath = fileInput.dataset.existingPath
    const existingType = fileInput.dataset.existingType
    
    if (!content && !file && !existingPath) return
    
    const formData = new FormData()
    formData.append('userId', currentUserId)
    formData.append('content', content)
    
    if (file) {
        formData.append('attachment', file)
    } else if (existingPath) {
        // Send existing file info as JSON
        formData.append('existingAttachment', JSON.stringify({
            path: existingPath,
            type: existingType
        }))
    }
    
    fetch(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            commentInput.value = ''
            clearCommentAttachment(post.id)
            fileInput.dataset.existingPath = ''
            fileInput.dataset.existingType = ''
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
        comment.replies = [];
    });

    // 2. Build tree
    const topLevelComments = [];
    post.comments.forEach(comment => {
        const parentId = comment.reference;
        if (parentId && parentId !== -1 && commentMap[parentId]) {
            commentMap[parentId].replies.push(comment);
        } else {
            topLevelComments.push(comment);
        }
    });

    // 3. Sort comments (newest first for top level)
    function sortCommentsByDate(comments) {
        comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        comments.forEach(c => {
            if (c.replies && c.replies.length) sortCommentsByDate(c.replies);
        });
    }
    sortCommentsByDate(topLevelComments);

    // 4. Create a container for all comments
    const allCommentsContainer = document.createElement('div');
    allCommentsContainer.classList.add('all-comments-container');
    
    // 5. Render ALL comments, but add 'comment_overflown' class to those after first 2
    let isOverflowing = topLevelComments.length > 2;
    
    topLevelComments.forEach((comment, index) => {
        const commentDiv = createCommentElement(comment, post.id, 0, onRefreshCallback);
        if (index >= 2) {
            commentDiv.classList.add('comment_overflown');
        }
        allCommentsContainer.appendChild(commentDiv);
    });
    
    // Add toggle button if needed
    if (isOverflowing) {
        const toggleBtn = document.createElement('button');
        toggleBtn.classList.add('show-all-comments-btn', 'postbutton');
        toggleBtn.textContent = `Показать все комментарии (${topLevelComments.length - 2})`;
        let isExpanded = false;
        
        toggleBtn.addEventListener('click', () => {
            const hiddenComments = allCommentsContainer.querySelectorAll('.comment_overflown');
            if (!isExpanded) {
                hiddenComments.forEach(comment => comment.classList.add('visible'));
                toggleBtn.textContent = `Скрыть комментарии`;
                isExpanded = true;
            } else {
                hiddenComments.forEach(comment => comment.classList.remove('visible'));
                toggleBtn.textContent = `Показать все комментарии (${topLevelComments.length - 2})`;
                isExpanded = false;
            }
        });
        
        commentsList.appendChild(allCommentsContainer);
        commentsList.appendChild(toggleBtn);
    } else {
        commentsList.appendChild(allCommentsContainer);
    }
    
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

function openCommentMediaDropdown(postId, fileInput, previewContainer, onSelect) {
    // Remove any existing dropdown
    const existing = document.querySelector('.comment-media-dropdown');
    if (existing) existing.remove();
    
    const dropdown = document.createElement('div');
    dropdown.className = 'comment-media-dropdown';
    dropdown.style.position = 'absolute';
    dropdown.style.background = 'white';
    dropdown.style.border = '2px solid #8FDADB';
    dropdown.style.borderRadius = '12px';
    dropdown.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    dropdown.style.padding = '8px 0';
    dropdown.style.minWidth = '160px';
    dropdown.style.zIndex = '9999';
    
    const options = [
        { type: 'photo', label: 'Фотография' },
        { type: 'video', label: 'Видеозапись' },
        { type: 'audio', label: 'Аудиозапись' },
        { type: 'gif', label: 'GIF' }
    ];
    
    options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'comment-media-dropdown-item';
        item.textContent = opt.label;
        item.style.padding = '10px 20px';
        item.style.cursor = 'pointer';
        item.style.transition = 'background 0.15s';
        item.style.fontSize = '14px';
        item.onmouseenter = () => item.style.background = '#f0f0f0';
        item.onmouseleave = () => item.style.background = 'transparent';
        
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.remove();
            
            if (opt.type === 'photo') {
                openCommentLibraryPicker(postId, opt.type, fileInput, previewContainer, onSelect);
            } else if (opt.type === 'video') {
                openCommentLibraryPicker(postId, 'video', fileInput, previewContainer, onSelect);
            } else if (opt.type === 'audio') {
                openCommentLibraryPicker(postId, 'audio', fileInput, previewContainer, onSelect);
            }
        });
        
        dropdown.appendChild(item);
    });
    
    // Position the dropdown under the button
    const btnRect = document.querySelector('.comment-attach-btn')?.getBoundingClientRect() || { bottom: 0, left: 0 };
    dropdown.style.left = btnRect.left + 'px';
    dropdown.style.top = (btnRect.bottom + 5) + 'px';
    
    document.body.appendChild(dropdown);
    
    // Close dropdown when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target) && !e.target.classList.contains('comment-attach-btn')) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 10);
}

function openCommentLibraryPicker(postId, type, fileInput, previewContainer, onSelect) {
    const overlay = document.createElement('div');
    overlay.className = 'add-lightbox-overlay';
    overlay.innerHTML = `
        <div class="add-lightbox add-lightbox-media">
            <button class="add-lightbox-close">×</button>
            <h3>${type === 'photo' ? 'Выберите фотографию' : 
                  type === 'gif' ? 'Выберите GIF' :
                  type === 'video' ? 'Выберите видео' : 'Выберите аудио'}</h3>
            <div class="add-lightbox-body">
                <div class="add-lightbox-upload-row">
                    <button class="postbutton add-upload-btn" id="comment-library-upload-btn">Загрузить...</button>
                    <input type="file" id="comment-library-upload" accept="${type === 'photo' ? 'image/*' : 
                                                                      type === 'gif' ? 'image/gif' :
                                                                      type === 'video' ? 'video/*' : 'audio/*'}" style="display:none;">
                </div>
                <div class="${type === 'audio' ? 'add-lightbox-grid-audio' : 'add-lightbox-grid'}" id="comment-library-grid">
                    <div class="add-lightbox-loading">Загрузка...</div>
                </div>
                <div class="add-lightbox-dropzone-overlay" id="comment-library-dropzone" style="display:none;">
                    <div class="add-lightbox-dropzone-content">
                        <span>📁 Перетащите файл сюда</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.add-lightbox-close');
    const grid = overlay.querySelector('#comment-library-grid');
    const uploadBtn = overlay.querySelector('#comment-library-upload-btn');
    const fileInputPicker = overlay.querySelector('#comment-library-upload');
    const dropzone = overlay.querySelector('#comment-library-dropzone');

    // Load library items
    async function loadGrid() {
        grid.innerHTML = '<div class="add-lightbox-loading">Загрузка...</div>';
        const currentUserId = localStorage.getItem('userId');
        let url = '';
        
        if (type === 'photo') url = `/api/users/photos?userId=${currentUserId}`;
        else if (type === 'gif') url = `/api/users/gifs?userId=${currentUserId}`;
        else if (type === 'video') url = `/api/users/videos?userId=${currentUserId}`;
        else if (type === 'audio') url = `/api/users/audios?userId=${currentUserId}`;
        
        try {
            const res = await fetch(url);
            const data = await res.json();
            grid.innerHTML = '';
            
            let items = [];
            if (type === 'photo' && data.photos) items = data.photos;
            else if (type === 'gif' && data.gifs) items = data.gifs;
            else if (type === 'video' && data.videos) items = data.videos;
            else if (type === 'audio' && data.audios) items = data.audios;
            
            if (items.length === 0) {
                grid.innerHTML = '<div class="add-lightbox-empty">Нет сохранённых файлов</div>';
                return;
            }
            
            items.forEach((item, index) => {
                let div;
                
                if (type === 'audio') {
                    // AUDIO - use the same style as post.js
                    div = document.createElement('div');
                    div.className = 'add-lightbox-grid-item-audio';
                    div.innerHTML = `
                        <span class="audio-order">${index + 1}</span>
                        <div class="audio-info">
                            <span class="audio-name">${item.name || 'Без названия'}</span>
                            <span class="audio-artist">${item.artist_name || 'Неизвестно'}</span>
                        </div>
                        <span class="audio-length">--:--</span>
                    `;
                } else if (type === 'video') {
                    div = document.createElement('div');
                    div.className = 'add-lightbox-grid-item add-lightbox-grid-item-video';
                    const video = document.createElement('video');
                    video.src = item.file_path || item.path;
                    video.muted = true;
                    video.preload = 'metadata';
                    video.addEventListener('mouseenter', () => video.play());
                    video.addEventListener('mouseleave', () => video.pause());
                    div.appendChild(video);
                } else {
                    div = document.createElement('div');
                    div.className = 'add-lightbox-grid-item';
                    const img = document.createElement('img');
                    img.src = item.file_path || item.path;
                    img.loading = 'lazy';
                    div.appendChild(img);
                }
                
                div.addEventListener('click', () => {
                    let fileType = type === 'photo' ? 'image' : 
                                   type === 'gif' ? 'image' :
                                   type === 'video' ? 'video' : 'audio';
                    
                    let path = item.file_path || item.path;
                    
                    if (type === 'photo' || type === 'gif') {
                        path = item.id ? `/photo/${item.id}` : path;
                    } else if (type === 'video') {
                        path = item.id ? `/video/${item.id}` : path;
                    } else if (type === 'audio') {
                        path = item.id ? `/audio/${item.id}` : path;
                    }
                    
                    if (typeof onSelect === 'function') {
                        onSelect({ path, type: fileType });
                    }
                    overlay.remove();
                });
                
                grid.appendChild(div);
            });
        } catch (err) {
            grid.innerHTML = '<div class="add-lightbox-empty">Ошибка загрузки</div>';
        }
    }

    // Upload button
    uploadBtn.addEventListener('click', () => fileInputPicker.click());
    
    fileInputPicker.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            let fileType = type === 'photo' ? 'image' : 
                           type === 'gif' ? 'image' :
                           type === 'video' ? 'video' : 'audio';
            
            if (typeof onSelect === 'function') {
                onSelect({ file, type: fileType });
            }
            overlay.remove();
        }
    });

    // Drag and drop
    let dragCounter = 0;
    overlay.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropzone.style.display = 'flex'; });
    overlay.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) dropzone.style.display = 'none'; });
    overlay.addEventListener('dragover', (e) => e.preventDefault());
    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzone.style.display = 'none';
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            const file = files[0];
            let fileType = type === 'photo' ? 'image' : 
                           type === 'gif' ? 'image' :
                           type === 'video' ? 'video' : 'audio';
            if (typeof onSelect === 'function') {
                onSelect({ file, type: fileType });
            }
            overlay.remove();
        }
    });

    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    loadGrid();
}

function createDeveloperBadge(user = { isDeveloper: true }) {
    return window.FortPortRoles?.createBadge(user) || document.createElement('span');
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
    commentAuthor.href = `/profile?id=${comment.userId}`;
    commentAuthor.textContent = commenterUsername;
    commentAuthor.classList.add('comment-author');
    window.FortPortRoles?.applyName(commentAuthor, { ...commenterData, ...comment, id: comment.userId });
    
    const commentTime = document.createElement('span');
    commentTime.classList.add('comment-time');
    commentTime.textContent = new Date(comment.createdAt).toLocaleString();


    const commentIdentity = document.createElement('span');
    commentIdentity.className = 'comment-author-identity';
    commentIdentity.appendChild(commentAuthor);
    const commentRoleBadge = window.FortPortRoles?.createBadge(
        { ...commenterData, ...comment, id: comment.userId },
        { compact: true }
    );
    if (commentRoleBadge) commentIdentity.appendChild(commentRoleBadge);

    authorName.appendChild(commentIdentity);
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
    // Get the raw comment text
    const rawComment = comment.content;
    // Linkify the plain text
    const linkedComment = linkify(rawComment);
    textDiv.innerHTML = linkedComment;
    // Preserve line breaks
    textDiv.style.whiteSpace = 'pre-wrap';
    contentRow.appendChild(textDiv);
}
  
    if (comment.attachment) {
        const attachmentDiv = document.createElement('div');
        attachmentDiv.classList.add('comment-attachment');
        if (comment.attachmentType === 'image' || comment.attachmentType === 'gif') {
            const img = document.createElement('img');
            img.src = comment.attachment;
            img.classList.add('comment-attachment-image');
            img.addEventListener('click', () => window.openLightbox({
                path: comment.attachment,
                type: comment.attachmentType,
                mediaId: comment.attachmentMediaId || null
            }));
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
    fileInput.id = `reply-file-${parentCommentId}`;
    fileInput.accept = 'image/*,video/*,audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function(e) { 
        const file = e.target.files[0];
        if (!file) return;
        
        const previewContainer = container.querySelector('.comment-preview-container');
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
    
    // Paste support for reply
    textarea.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                
                const file = item.getAsFile();
                const fileName = `pasted-image-${Date.now()}.png`;
                const imageFile = new File([file], fileName, { type: file.type });
                
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(imageFile);
                fileInput.files = dataTransfer.files;
                
                const changeEvent = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(changeEvent);
                
                textarea.style.border = '2px solid green';
                setTimeout(() => {
                    textarea.style.border = '';
                }, 1000);
                
                break;
            }
        }
    });
    
    const attachBtn = document.createElement('button');
    attachBtn.textContent = 'Прикрепить';
    attachBtn.classList.add('comment-attach-btn');
    attachBtn.onclick = function(e) { 
        e.preventDefault();
        e.stopPropagation();
        
        // Remove any existing dropdown
        const existing = document.querySelector('.comment-media-dropdown');
        if (existing) existing.remove();
        
        const rect = attachBtn.getBoundingClientRect();
        const dropdown = document.createElement('div');
        dropdown.className = 'comment-media-dropdown';
        dropdown.style.position = 'fixed';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 5) + 'px';
        dropdown.style.background = 'white';
        dropdown.style.border = '2px solid #8FDADB';
        dropdown.style.borderRadius = '12px';
        dropdown.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        dropdown.style.padding = '8px 0';
        dropdown.style.minWidth = '160px';
        dropdown.style.zIndex = '9999';
        
        const options = [
            { type: 'photo', label: 'Фотография' },
            { type: 'video', label: 'Видеозапись' },
            { type: 'audio', label: 'Аудиозапись' },
            { type: 'gif', label: 'GIF' }
        ];
        
        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'comment-media-dropdown-item';
            item.textContent = opt.label;
            item.style.padding = '10px 20px';
            item.style.cursor = 'pointer';
            item.style.transition = 'background 0.15s';
            item.style.fontSize = '14px';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.remove();
                
                // Get the preview container inside THIS reply container
                const previewContainer = container.querySelector('.comment-preview-container');
                if (!previewContainer) return;
                
                const onSelect = function(fileData) {
                    if (fileData.file) {
                        // New file upload
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(fileData.file);
                        fileInput.files = dataTransfer.files;
                        const changeEvent = new Event('change', { bubbles: true });
                        fileInput.dispatchEvent(changeEvent);
                        textarea.focus();
                    } else if (fileData.path) {
                        // Existing library file
                        previewContainer.innerHTML = '';
                        
                        if (fileData.type === 'image' || fileData.type === 'gif') {
                            const img = document.createElement('img');
                            img.src = fileData.path;
                            img.classList.add('comment-preview-image');
                            previewContainer.appendChild(img);
                        } else if (fileData.type === 'video') {
                            const video = document.createElement('video');
                            video.src = fileData.path;
                            video.controls = true;
                            previewContainer.appendChild(video);
                        } else if (fileData.type === 'audio') {
                            const audio = document.createElement('audio');
                            audio.src = fileData.path;
                            audio.controls = true;
                            previewContainer.appendChild(audio);
                        }
                        
                        previewContainer.style.display = 'block';
                        fileInput.dataset.existingPath = fileData.path;
                        fileInput.dataset.existingType = fileData.type;
                    }
                };
                
                openCommentLibraryPicker(postId, opt.type, fileInput, previewContainer, onSelect);
            });
            
            dropdown.appendChild(item);
        });
        
        document.body.appendChild(dropdown);
        
        // Close dropdown when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function closeDropdown(e) {
                if (!dropdown.contains(e.target) && e.target !== attachBtn) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            });
        }, 10);
    }
    
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
    
    // File preview container
    const previewContainer = document.createElement('div');
    previewContainer.classList.add('comment-preview-container');
    previewContainer.style.display = 'none';
    container.appendChild(previewContainer);
    
    sendBtn.addEventListener('click', async () => {
        const content = textarea.value.trim();
        const file = fileInput.files[0];
        const existingPath = fileInput.dataset.existingPath;
        const existingType = fileInput.dataset.existingType;
        
        if (!content && !file && !existingPath) return;
        
        const formData = new FormData();
        formData.append('userId', localStorage.getItem('userId'));
        formData.append('content', content);
        
        if (file) {
            formData.append('attachment', file);
        } else if (existingPath) {
            formData.append('existingAttachment', JSON.stringify({
                path: existingPath,
                type: existingType
            }));
        }
        
        formData.append('refId', parentCommentId);
        
        try {
            const response = await fetch(`/api/posts/${postId}/comments`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                container.remove();
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

function openFlagModal(postId) {
    // Remove existing modal
    const existing = document.querySelector('.flag-modal-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'flag-modal-overlay';
    overlay.innerHTML = `
        <div class="flag-modal">
            <button class="flag-modal-close">×</button>
            <h3>Пожаловаться на пост</h3>
            <p style="font-size:14px; color:#666; margin-bottom:12px;">Вы уверены, что этот пост нарушает правила?</p>
            
            <div class="flag-modal-group">
                <label>Причина жалобы</label>
                <select id="flag-type-select">
                    <option value="spam">Спам</option>
                    <option value="unmarked_nsfw">Нет цензуры на контенте 18+</option>
                    <option value="harassment">Разжигание конфликта</option>
                    <option value="hatespeech">Язык вражды</option>
                    <option value="illegal">Нелегальный контент</option>
                </select>
            </div>
            
            <div class="flag-modal-group">
                <label>Примечания (опционально)</label>
                <textarea id="flag-notes-input" placeholder="Напишите что-нибудь..." rows="3"></textarea>
            </div>
            
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px;">
                <button class="flag-cancel-btn">Отмена</button>
                <button class="flag-submit-btn">Отправить жалобу</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Close button
    overlay.querySelector('.flag-modal-close').addEventListener('click', () => {
        overlay.remove();
    });
    
    // Cancel button
    overlay.querySelector('.flag-cancel-btn').addEventListener('click', () => {
        overlay.remove();
    });
    
    // Click outside to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    
    // Submit button
    const submitBtn = overlay.querySelector('.flag-submit-btn');
    submitBtn.addEventListener('click', async () => {
        const flagType = overlay.querySelector('#flag-type-select').value;
        const notes = overlay.querySelector('#flag-notes-input').value.trim();
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправка...';
        
        try {
            const response = await fetch('/api/posts/flag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postId, flagType, notes })
            });
            
            const data = await response.json();
            
            if (data.success) {
                overlay.innerHTML = `
                    <div style="text-align:center; padding:20px;">
                        <h3 style="color:#4CAF50;">Жалоба отправлена</h3>
                        <p style="color:#666; margin-top:8px;">Модераторы рассмотрят ваш запрос.</p>
                        <button onclick="this.closest('.flag-modal-overlay').remove()" style="margin-top:16px; padding:8px 24px; border-radius:8px; border:2px solid #8FDADB; background:white; cursor:pointer;">Закрыть</button>
                    </div>
                `;
            } else {
                alert('Ошибка: ' + (data.error || 'Не удалось отправить жалобу'));
                submitBtn.disabled = false;
                submitBtn.textContent = 'Отправить жалобу';
            }
        } catch (err) {
            console.error('Flag error:', err);
            alert('Ошибка сервера');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Отправить жалобу';
        }
    });
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
    if (!text) return '';
    
    // First, escape HTML to prevent XSS
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    
    // Match URLs but stop at punctuation that shouldn't be part of the URL
    // This regex looks for http://, https://, or www. and captures until hitting
    // space, line end, or any of the specified punctuation characters
    const urlPattern = /(\b(https?:\/\/)[^\s<>{}()\[\]|,;"'`]+|(^|[^\/])(www\.[^\s<>{}()\[\]|,;"'`]+))/gim;
    
    function isValidHttpUrl(string) {
        try {
            // Remove trailing punctuation that might have been included
            let cleanUrl = string;
            // Trim trailing punctuation that shouldn't be part of URL
            while (cleanUrl.length && /[{}()\[\],;"'`.]$/.test(cleanUrl)) {
                // Special case: don't remove dot if it's part of domain extension
                if (cleanUrl.endsWith('.') && cleanUrl.match(/\.(com|org|net|ru|io|us|uk|de|fr|jp|cn)\.[a-z]+$/i)) {
                    break;
                }
                if (cleanUrl.endsWith('.') && !cleanUrl.slice(0, -1).includes('.')) {
                    break;
                }
                cleanUrl = cleanUrl.slice(0, -1);
            }
            const url = new URL(cleanUrl);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
            return false;
        }
    }
    
    let result = escaped;
    
    // Handle http:// and https:// URLs
    result = result.replace(/(https?:\/\/[^\s<>{}()\[\]|,;"'`]+)/g, function(match) {
        // Validate the URL
        let cleanMatch = match;
        // Remove trailing punctuation that shouldn't be part of URL
        while (cleanMatch.length && /[{}()\[\],;"'`]$/.test(cleanMatch)) {
            cleanMatch = cleanMatch.slice(0, -1);
        }
        if (isValidHttpUrl(cleanMatch)) {
            return `<a href="${cleanMatch}" target="_blank" rel="noopener noreferrer" class="linkified">${match}</a>`;
        }
        return match;
    });
    
    // Handle www. URLs (without protocol)
    result = result.replace(/(^|\s)(www\.[^\s<>{}()\[\]|,;"'`]+)/g, function(match, prefix, url) {
        let cleanUrl = url;
        // Remove trailing punctuation
        while (cleanUrl.length && /[{}()\[\],;"'`]$/.test(cleanUrl)) {
            cleanUrl = cleanUrl.slice(0, -1);
        }
        const fullUrl = 'https://' + cleanUrl;
        if (isValidHttpUrl(fullUrl)) {
            return `${prefix}<a href="${fullUrl}" target="_blank" rel="noopener noreferrer" class="linkified">${url}</a>`;
        }
        return match;
    });
    
    return result;
}

window.undoVote = undoVote
window.addVote = addVote
window.castVote = castVote