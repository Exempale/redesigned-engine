// client.js
import * as PostDisplay from './display-post.js'

// Define lightbox functions FIRST
let currentLastPostId = null;  // Track the last loaded post ID for pagination
let isLoading = false;          // Prevent multiple simultaneous loads
let hasMorePosts = true;        // Whether there are more posts to load
let currentFilteredPosts = [];  // Store currently loaded posts

let currentFeedSettings = {
    sort: 'new',        // 'new', 'popular', 'trending'
    timeRange: null,    // null, '24h', 'week', 'month', '6months', 'year'
    filter: 'all'       // 'all', 'friends', 'subscriptions', 'recommended'
};

let feedConfig = {
    sort: 'new',
    timeRange: null,
    filter: 'all'
};

const lightbox = document.createElement('div')
lightbox.id = 'lightbox'
lightbox.style.display = 'none'
document.body.appendChild(lightbox)

function closeLightbox() {
  lightbox.style.display = 'none'
  lightbox.innerHTML = ''
  document.body.style.overflow = ''
}

function openLightbox(imageSource, mediaItems = null) {
  lightbox.style.display = 'flex'
  document.body.style.overflow = 'hidden'
  
  lightbox.innerHTML = ''

  const normalizeMediaItem = (item) => {
    if (typeof item === 'string') {
      const pathPhotoId = item.match(/^\/photo\/(\d+)/)?.[1]
      return {
        path: item,
        type: 'image',
        mediaId: pathPhotoId ? Number(pathPhotoId) : null
      }
    }

    const path = item?.path || item?.url || ''
    const pathPhotoId = path.match(/^\/photo\/(\d+)/)?.[1]
    return {
      ...item,
      path,
      type: item?.type || 'image',
      mediaId: item?.mediaId || item?.photoId || (pathPhotoId ? Number(pathPhotoId) : null)
    }
  }

  const initialItem = normalizeMediaItem(imageSource)
  const normalizedMediaItems = Array.isArray(mediaItems) && mediaItems.length
    ? mediaItems.map(normalizeMediaItem)
    : [initialItem]
  const hasMultiple = normalizedMediaItems.length > 1
  const currentPath = initialItem.path
  let currentPhotoId = initialItem.mediaId || null
  let currentPhotoData = null
  let currentIndex = normalizedMediaItems.findIndex(item => {
    if (currentPhotoId && item.mediaId) return Number(item.mediaId) === Number(currentPhotoId)
    return item.path === currentPath
  })
  if (currentIndex === -1) currentIndex = 0
  
  const lightboxContent = document.createElement('div');
  lightboxContent.classList.add('lightbox-content');
  
  const mediaDisplay = document.createElement('div');
  mediaDisplay.classList.add('lightbox-media-display');
  
  // Close button
  const closeBtn = document.createElement('span');
  closeBtn.classList.add('lightbox-close');
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = function(e) {
    e.stopPropagation();
    closeLightbox();
  };
  lightboxContent.appendChild(closeBtn);
  
  const mediaContainer = document.createElement('div');
  mediaContainer.classList.add('lightbox-media-container');
  
  function updateMedia(index) {
    mediaContainer.innerHTML = ''
    currentIndex = index
    const item = normalizedMediaItems[index]
    currentPhotoId = item.mediaId || null
    currentPhotoData = null
    
    if (item.type === 'image' || item.type === 'gif') {
      const img = document.createElement('img');
      img.src = item.path;
      img.classList.add('lightbox-single-img');
      mediaContainer.appendChild(img);
    } else if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = item.path;
      video.controls = true;
      video.classList.add('lightbox-single-img');
      video.autoplay = true;
      mediaContainer.appendChild(video);
    }
    
    resetFooterForMedia(item)

    if (currentPhotoId) {
      fetch(`/api/photo/${currentPhotoId}`, { credentials: 'same-origin' })
        .then(r => {
          if (!r.ok) throw new Error('Photo metadata unavailable')
          return r.json()
        })
        .then(data => {
          currentPhotoData = data
          updateFooter(data)
        })
        .catch(err => console.error('Failed to fetch photo metadata:', err))
    }
    
    if (counter) {
      counter.textContent = `${index + 1} / ${normalizedMediaItems.length}`
    }
  }
  
  let prevBtn = null;
  let nextBtn = null;
  let counter = null;
  
  if (hasMultiple) {
    prevBtn = document.createElement('button');
    prevBtn.classList.add('lightbox-nav', 'lightbox-prev');
    prevBtn.innerHTML = '←';
    prevBtn.onclick = function(e) {
      e.stopPropagation();
      currentIndex = (currentIndex - 1 + normalizedMediaItems.length) % normalizedMediaItems.length;
      updateMedia(currentIndex);
    };
    lightboxContent.appendChild(prevBtn);
    
    nextBtn = document.createElement('button');
    nextBtn.classList.add('lightbox-nav', 'lightbox-next');
    nextBtn.innerHTML = '→';
    nextBtn.onclick = function(e) {
      e.stopPropagation();
      currentIndex = (currentIndex + 1) % normalizedMediaItems.length;
      updateMedia(currentIndex);
    };
    lightboxContent.appendChild(nextBtn);
    
    counter = document.createElement('div');
    counter.classList.add('lightbox-counter');
    counter.textContent = `${currentIndex + 1} / ${normalizedMediaItems.length}`;
    lightboxContent.appendChild(counter);
  }
  
  mediaDisplay.appendChild(mediaContainer);
  lightboxContent.appendChild(mediaDisplay);
  
  // --- CLICK ON BACKGROUND TO CLOSE ---
  // Only close if clicking directly on mediaDisplay (the background area)
  mediaDisplay.addEventListener('click', function(e) {
    if (e.target === mediaDisplay) {
      closeLightbox();
    }
  });
  
  // Also close if clicking on lightboxContent background
  lightboxContent.addEventListener('click', function(e) {
    if (e.target === lightboxContent) {
      closeLightbox();
    }
  });
  
  // --- FOOTER --- (same as before)
  const footer = document.createElement('div');
  footer.classList.add('lightbox-footer');
  
  const leftSection = document.createElement('div');
  leftSection.classList.add('lightbox-footer-left');
  
  const avatar = document.createElement('img');
  avatar.classList.add('lightbox-footer-avatar');
  avatar.src = '/default-avatar.jpg';
  leftSection.appendChild(avatar);
  
  const userInfo = document.createElement('div');
  userInfo.classList.add('lightbox-footer-userinfo');
  
  const usernameRow = document.createElement('div');
  usernameRow.classList.add('lightbox-footer-username-row');
  const username = document.createElement('span');
  username.classList.add('lightbox-footer-username');
  username.textContent = 'Загрузка...';
  usernameRow.appendChild(username);
  userInfo.appendChild(usernameRow);
  
  const date = document.createElement('span');
  date.classList.add('lightbox-footer-date');
  date.textContent = '';
  userInfo.appendChild(date);
  
  leftSection.appendChild(userInfo);
  footer.appendChild(leftSection);
  
  const rightSection = document.createElement('div');
  rightSection.classList.add('lightbox-footer-right');
  
  const currentUserId = parseInt(localStorage.getItem('userId'));
  
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Сохранить себе';
  saveBtn.classList.add('lightbox-footer-btn');
  saveBtn.onclick = function(e) {
    e.stopPropagation();
    if (!currentUserId) {
        alert('Войдите, чтобы сохранять');
        return;
    }
    if (!currentPhotoId) {
        alert('Не удалось определить изображение');
        return;
    }
    fetch('/api/photos/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: currentPhotoId })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            saveBtn.textContent = 'Сохранено';
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
            saveBtn.style.cursor = 'default';
            if (currentPhotoData) {
                currentPhotoData.isSaved = true;
            }
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось сохранить'));
        }
    })
    .catch(err => {
        console.error('Save error:', err);
        alert('Ошибка сервера');
    });
};
  rightSection.appendChild(saveBtn);
  
  const openPageBtn = document.createElement('button');
  openPageBtn.textContent = 'Открыть в новой странице';
  openPageBtn.classList.add('lightbox-footer-btn');
  openPageBtn.onclick = function(e) {
    e.stopPropagation();
    if (currentPhotoId) {
      window.open(`/photo/${currentPhotoId}/page`, '_blank');
    }
  };
  rightSection.appendChild(openPageBtn);
  
  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Скачать';
  downloadBtn.classList.add('lightbox-footer-btn');
  downloadBtn.onclick = function(e) {
    e.stopPropagation();
    const currentPath2 = normalizedMediaItems[currentIndex].path;
    const link = document.createElement('a');
    link.href = currentPath2;
    link.download = currentPath2.split('/').pop() || 'image';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  rightSection.appendChild(downloadBtn);
  
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Удалить';
  deleteBtn.classList.add('lightbox-footer-btn', 'lightbox-footer-delete');
  deleteBtn.style.display = 'none';
  deleteBtn.onclick = function(e) {
    e.stopPropagation();
    if (!confirm('Удалить это изображение?')) return;
    fetch(`/api/photo/${currentPhotoId}`, {
      method: 'DELETE'
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeLightbox();
        if (typeof resetAndLoadFeed === 'function') resetAndLoadFeed();
      } else {
        alert('Ошибка: ' + (data.error || 'Не удалось удалить'));
      }
    })
    .catch(err => {
      console.error('Delete error:', err);
      alert('Ошибка сервера');
    });
  };
  rightSection.appendChild(deleteBtn);

  function resetFooterForMedia(item) {
    avatar.src = '/default-avatar.jpg'
    username.textContent = item.mediaId ? 'Загрузка...' : 'Медиафайл'
    window.FortPortRoles?.applyName(username, {});
    usernameRow.querySelector('.role-badge')?.remove();
    date.textContent = ''
    deleteBtn.style.display = 'none'
    openPageBtn.disabled = !item.mediaId
    saveBtn.disabled = !item.mediaId
    saveBtn.textContent = item.mediaId
      ? (item.type === 'gif' ? 'Сохранить GIF' : 'Сохранить себе')
      : 'Сохранение недоступно'
    saveBtn.style.opacity = item.mediaId ? '1' : '0.5'
    saveBtn.style.cursor = item.mediaId ? 'pointer' : 'default'
  }
  
  footer.appendChild(rightSection);
  lightboxContent.appendChild(footer);
  lightbox.appendChild(lightboxContent);
  
  function updateFooter(data) {
    openPageBtn.disabled = false
    avatar.src = data.profilePicture || '/default-avatar.jpg';
    username.textContent = data.username || 'Аноним';
    window.FortPortRoles?.applyName(username, data);
    usernameRow.querySelector('.role-badge')?.remove();
    const roleBadge = window.FortPortRoles?.createBadge(data, { compact: true, button: false });
    if (roleBadge) usernameRow.appendChild(roleBadge);
    date.textContent = data.createdAt ? new Date(data.createdAt).toLocaleString() : '';
    
    // Show/hide delete button
    if (data.uploadedBy === currentUserId) {
        deleteBtn.style.display = 'inline-block';
    } else {
        deleteBtn.style.display = 'none';
    }
    
    // Show/hide save button based on isSaved
    if (data.isSaved) {
        saveBtn.textContent = 'Сохранено';
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'default';
    } else {
        const label = data.isGif ? 'Сохранить GIF' : 'Сохранить себе';
        saveBtn.textContent = label;
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    }
}

  updateMedia(currentIndex)
  
  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (lightbox.style.display !== 'flex') return;
    if (e.key === 'ArrowLeft' && hasMultiple) {
      currentIndex = (currentIndex - 1 + normalizedMediaItems.length) % normalizedMediaItems.length;
      updateMedia(currentIndex);
    } else if (e.key === 'ArrowRight' && hasMultiple) {
      currentIndex = (currentIndex + 1) % normalizedMediaItems.length;
      updateMedia(currentIndex);
    } else if (e.key === 'Escape') {
      closeLightbox();
    }
  });
}

window.openLightbox = openLightbox
window.closeLightbox = closeLightbox

lightbox.addEventListener('click', function(e) {
  if (e.target === lightbox) {
    closeLightbox()
  }
})

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && lightbox.style.display === 'flex') {
    closeLightbox()
  }
})

function loadUserAvatar() {
  const username = localStorage.getItem('username')
  
  if (!username) return
  
  if (localStorage.getItem('userAvatar')) {
    updateNavAvatar(localStorage.getItem('userAvatar'))
    return
  }
  
  fetch(`/api/users/${username}`)
    .then(r => r.json())
    .then(user => {
      if (user && user.profilePicture) {
        localStorage.setItem('userAvatar', user.profilePicture)
        updateNavAvatar(user.profilePicture)
      } else {
        localStorage.setItem('userAvatar', '/default-avatar.jpg')
        updateNavAvatar('/default-avatar.jpg')
      }
    })
    .catch(err => {
      console.error('Error loading avatar:', err)
      localStorage.setItem('userAvatar', '/default-avatar.jpg')
      updateNavAvatar('/default-avatar.jpg')
    })
}

function updateNavAvatar(avatarUrl) {
  const navAvatar = document.querySelector('.nav-avatar')
  if (navAvatar) {
    navAvatar.src = avatarUrl
  }
  
  const menuTrigger = document.querySelector('.user-menu-trigger img')
  if (menuTrigger) {
    menuTrigger.src = avatarUrl
  }
}

document.addEventListener('DOMContentLoaded', function() {
  loadUserAvatar()
    const feedWay = document.getElementById('feed-way');
    if (feedWay) {
        feedWay.addEventListener('change', function() {
            feedConfig.filter = this.value;
            resetAndLoadFeed();
        });
    }
})

let currentTab = 'feed'
let currentUserData = null

document.addEventListener('DOMContentLoaded', () => {
    const isLoggedIn = localStorage.getItem('username')

    const path = window.location.pathname;
    const isMainPage = path === '/' || path.includes('/main');
    if (isMainPage) {
    initFeed();
    const tabs = document.querySelectorAll('.tab-btn')
    tabs.forEach(tab => {
        const tabName = tab.dataset.tab
        if (!isLoggedIn && tabName !== 'feed') {
            tab.style.display = 'none'
        } else {
            tab.style.display = 'block'
        }
        
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'))
            tab.classList.add('active')
            currentTab = tab.dataset.tab
            resetAndLoadFeed()
        })
    })
    
    tabs.forEach(t => t.classList.remove('active'))
    const activeTab = document.querySelector(`.tab-btn[data-tab="${currentTab}"]`)
    if (activeTab) activeTab.classList.add('active')
}
})

// Reset pagination state and load fresh feed
function resetAndLoadFeed() {
    // Read the filter from the dropdown
    const feedWay = document.getElementById('feed-way');
    if (feedWay) {
        feedConfig.filter = feedWay.value;
    }
    
    currentLastPostId = -1;
    hasMorePosts = true;
    isLoading = false;
    currentFilteredPosts = [];
    const container = document.getElementById('feed');
    if (container) container.innerHTML = '';
    loadMorePosts();
}

// Load more posts using the current last post ID
async function loadMorePosts() {
    if (isLoading || !hasMorePosts) return;
    
    isLoading = true;
    
    try {
        const { userMap } = await PostDisplay.loadUserMap();
        const currentUserId = parseInt(localStorage.getItem('userId'));
        let userData = null;
        
        if (currentUserId) {
            const userRes = await fetch(`/api/users/${currentUserId}`);
            userData = await userRes.json();
            currentUserData = userData;
        }
        
        // Build URL with feed settings
        let url = `/api/posts/feed/${currentLastPostId === -1 ? -1 : currentLastPostId}`;
        url += `?filter=${feedConfig.filter}`;
        url += `&sort=${feedConfig.sort}`;
        if (feedConfig.timeRange) {
            url += `&timeRange=${feedConfig.timeRange}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.posts || data.posts.length === 0) {
            hasMorePosts = false;
            isLoading = false;
            return;
        }
        
        // Filter posts based on current tab
        let newPosts = filterPostsByTab(data.posts, userData, currentUserId);
        
        if (newPosts.length === 0 && data.posts.length > 0) {
            // All posts were filtered out, but there might be more
            currentLastPostId = data.nextPostId;
            isLoading = false;
            loadMorePosts(); // Try again
            return;
        }
        
        // Append to existing posts (not replace)
        currentFilteredPosts = [...currentFilteredPosts, ...newPosts];

// Update last post ID
currentLastPostId = data.nextPostId;
if (currentLastPostId === null) {
    hasMorePosts = false;
}

// APPEND new posts instead of re-rendering everything
const feedContainer = document.getElementById('feed');
if (feedContainer) {
    // Get only the NEW posts (last batch)
    const newPostsOnly = currentFilteredPosts.slice(-newPosts.length);
    PostDisplay.appendPosts('feed', newPostsOnly, resetAndLoadFeed);
}
        
    } catch (err) {
        console.error('Error loading posts:', err);
    } finally {
        isLoading = false;
    }
}

// Filter posts based on current tab
function filterPostsByTab(posts, userData, currentUserId) {
        return [...posts];
}

// Scroll listener - load more when near bottom
function setupScrollListener() {
    window.addEventListener('scroll', () => {
        const scrollHeight = document.documentElement.scrollHeight;
        const scrollTop = window.scrollY;
        const clientHeight = window.innerHeight;
        
        // Load more when 300px from bottom
        if (scrollHeight - (scrollTop + clientHeight) < 300) {
            loadMorePosts();
        }
    });
}

// Initialize the feed
function initFeed() {
    resetAndLoadFeed();
    setupScrollListener();
}

// Start

function openProfilePicture(imagePath) {
    if (!imagePath || imagePath === '/default-avatar.jpg') return;
    if (typeof window.openLightbox === 'function') {
        window.openLightbox(imagePath);
    }
}


function openFeedConfig(event) {
    // Remove existing popup if any
    const existing = document.getElementById('feed-settings-popup');
    if (existing) {
        existing.remove();
        return;
    }
    
    // Get mouse position from the event
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    
    const popup = document.createElement('div');
    popup.id = 'feed-settings-popup';
    popup.className = 'feed-settings-popup';
    
    // Position at mouse click, offset to not cover the button
    const isMobile = window.innerWidth < 830;

    popup.style.left = (mouseX + 30 - (isMobile ? 320 : 0)) + 'px';
    popup.style.top = (mouseY - 80) + 'px';
    
    popup.innerHTML = `
        <div class="feed-settings-content">
            <div class="feed-settings-header">
                <h3>Настройки ленты</h3>
                <button class="chat-exit-btn" onclick="closeFeedConfig()">×</button>
            </div>
            <div class="feed-settings-body">
                <div class="feed-settings-group">
                    <label>Сортировка</label>
                    <select id="feed-sort" onchange="onFeedSortChange()">
                        <option value="new" ${feedConfig.sort === 'new' ? 'selected' : ''}>Сначала новое</option>
                        <option value="popular" ${feedConfig.sort === 'popular' ? 'selected' : ''}>Сначала популярное</option>
                        
                    </select>
                </div>
                <div class="feed-settings-group" id="time-range-group" style="${feedConfig.sort === 'popular' ? 'display:block' : 'display:none'}">
                    <label>За последние</label>
                    <select id="feed-time-range">
                        <option value="24h" ${feedConfig.timeRange === '24h' ? 'selected' : ''}>24 часа</option>
                        <option value="week" ${feedConfig.timeRange === 'week' ? 'selected' : ''}>Неделю</option>
                        <option value="month" ${feedConfig.timeRange === 'month' ? 'selected' : ''}>Месяц</option>
                        <option value="6months" ${feedConfig.timeRange === '6months' ? 'selected' : ''}>Пол года</option>
                        <option value="year" ${feedConfig.timeRange === 'year' ? 'selected' : ''}>Год</option>
                    </select>
                </div>
                <button class="feed-settings-apply" onclick="applyFeedSettings()">Применить</button>
            </div>
        </div>
    `;
    document.body.appendChild(popup);
}

function closeFeedConfig() {
    const popup = document.getElementById('feed-settings-popup');
    if (popup) popup.remove();
}

function onFeedSortChange() {
    const sort = document.getElementById('feed-sort').value;
    const timeRangeGroup = document.getElementById('time-range-group');
    if (sort === 'popular') {
        timeRangeGroup.style.display = 'block';
    } else {
        timeRangeGroup.style.display = 'none';
    }
}

function applyFeedSettings() {
    const sort = document.getElementById('feed-sort').value;
    const timeRange = document.getElementById('feed-time-range')?.value || null;
    
    feedConfig.sort = sort;
    feedConfig.timeRange = sort === 'popular' ? timeRange : null;
    
    closeFeedConfig();
    resetAndLoadFeed();
}

// Make functions global for onclick
window.openFeedConfig = openFeedConfig;
window.closeFeedConfig = closeFeedConfig;
window.onFeedSortChange = onFeedSortChange;
window.applyFeedSettings = applyFeedSettings;
window.openProfilePicture = openProfilePicture
window.resetAndLoadFeed = resetAndLoadFeed