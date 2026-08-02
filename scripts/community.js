// community.js
import * as PostDisplay from './display-post.js'

// DEBUG FUNCTION
function debug(msg) {
    const debugDiv = document.getElementById('debug-messages');
    if (debugDiv) {
        const entry = document.createElement('div');
        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `${timestamp}: ${String(msg)}`;
        debugDiv.appendChild(entry);
        debugDiv.scrollTop = debugDiv.scrollHeight;
        while (debugDiv.children.length > 20) {
            debugDiv.removeChild(debugDiv.firstChild);
        }
    }
    console.log(msg);
}

let currentCommunity = null
let isEditing = false
let currentLastPostId = null;
let isLoading = false;
let hasMorePosts = true;
let allPosts = [];

// PAGE-WIDE PARAMS FOR POST CREATOR
window.communityPageData = {
    isCommunityPage: false,
    communityId: null,
    communityType: null,
    canPost: false,
    isOwner: false,
    isModerator: false,
    communityName: null,
    communityAvatar: '/default-avatar.jpg'
}

if (!sessionStorage.getItem('userId')) {
    syncFromLocalStorage()
}

const urlParams = new URLSearchParams(window.location.search)
const communityId = Number(urlParams.get('id'))
const hasValidCommunityId =
  Number.isSafeInteger(communityId) && communityId > 0

if (!hasValidCommunityId) {
  debug('No valid community ID provided')
  window.location.replace('/')
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  })
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  if (data === null) {
    throw new Error('Сервер вернул некорректный ответ')
  }

  return data
}

function getSafeMediaUrl(value, fallback = '') {
  if (typeof value !== 'string' || !value.trim()) return fallback

  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return fallback
    if (!['http:', 'https:'].includes(url.protocol)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName)
  if (className) element.className = className
  if (text !== undefined) element.textContent = String(text)
  return element
}

function loadCommunity() {
  // Reset pagination
  currentLastPostId = null;
  hasMorePosts = true;
  isLoading = false;
  allPosts = [];
  
  // Load community info and first batch of posts
  Promise.all([
    fetchJson(`/api/communities/${communityId}`),
    fetchJson(`/api/communities/${communityId}/posts`)
  ])
  .then(([community, posts]) => {
    if (!community || typeof community !== 'object' || Array.isArray(community)) {
      throw new Error('Некорректные данные порта')
    }
    if (!Array.isArray(posts)) {
      throw new Error('Некорректные данные публикаций')
    }

    debug(`Community loaded: ${community.username || 'Без названия'}`);
    debug(`Posts loaded: ${posts.length}`);

    const profileBackground = getSafeMediaUrl(community.profileBackground)
    document.body.style.backgroundImage = profileBackground
      ? `url("${profileBackground.replace(/"/g, '%22')}")`
      : ''

    currentCommunity = community;
    document.title = String(currentCommunity.username || 'FortPort')
    
    // SET PAGE-WIDE PARAMS
    const currentUserId = parseInt(localStorage.getItem('userId'))
    const isOwner = community.owner === currentUserId
    const isModerator = community.moderators?.includes(currentUserId)
    const canPost = isOwner || isModerator || community.type === 'community'
    
    window.communityPageData = {
        isCommunityPage: true,
        communityId,
        communityType: community.type,
        canPost,
        isOwner,
        isModerator,
        communityName: String(community.username || 'Без названия'),
        communityAvatar: getSafeMediaUrl(
          community.profilePicture,
          '/default-avatar.jpg'
        )
    }

    if (currentUserId && canPost) {
        makePostCreator();
    }
    
    displayCommunity(community);
    
    // Store posts and display
    allPosts = posts;
    if (posts.length > 0) {
        currentLastPostId = posts[posts.length - 1].id;
    }
    if (posts.length < 15) {
        hasMorePosts = false;
    }
    displayCommunityPosts(allPosts);
  })
  .catch(err => {
    debug(`ERROR: ${err.message}`);
    const contentDiv = document.getElementById('community-content');
    if (contentDiv) {
      const errorBox = createElement('div', 'community-load-error')
      errorBox.style.textAlign = 'center'
      errorBox.style.padding = '40px'
      errorBox.style.color = '#ff4444'
      errorBox.appendChild(createElement('div', '', 'Порт не найден'))
      errorBox.appendChild(
        createElement(
          'small',
          '',
          err instanceof Error ? err.message : 'Неизвестная ошибка'
        )
      )
      contentDiv.replaceChildren(errorBox)
    }
  })
}

function displayCommunityPosts(posts, append = false) {
  debug(`displayCommunityPosts called with ${posts.length} posts, append: ${append}`);
  
  const feedContainer = document.getElementById('community-feed');
  if (!feedContainer) {
    debug('ERROR: community-feed element not found!');
    return;
  }
  
  const postCountElement = document.getElementById('post-count');
  if (postCountElement) {
    postCountElement.textContent = allPosts.length;
  }
  
  PostDisplay.loadUserMap().then(() => {
    if (append) {
      // Append new posts to existing feed
      PostDisplay.appendPosts('community-feed', posts, loadCommunity);
    } else {
      // Replace entire feed (initial load)
      PostDisplay.displayPosts('community-feed', posts, loadCommunity);
    }
  }).catch(err => {
    debug(`Error loading user map: ${err.message}`);
  });
}

// Load more community posts
async function loadMoreCommunityPosts() {
    if (isLoading || !hasMorePosts) return;
    console.log('SHIT')
    isLoading = true;
    
    try {
        const url = `/api/communities/${communityId}/posts?before=${encodeURIComponent(currentLastPostId)}&limit=15`;
        const newPosts = await fetchJson(url);

        if (!Array.isArray(newPosts)) {
            throw new Error('Некорректные данные публикаций');
        }
        if (newPosts.length === 0) {
            hasMorePosts = false;
            isLoading = false;
            return;
        }
        
        // Store the new posts
        const startIndex = allPosts.length;
        allPosts = [...allPosts, ...newPosts];
        currentLastPostId = newPosts[newPosts.length - 1].id;
        
        if (newPosts.length < 15) {
            hasMorePosts = false;
        }
        
        // APPEND the new posts (not replace)
        displayCommunityPosts(newPosts, true);
        
    } catch (err) {
        console.error('Error loading more community posts:', err);
    } finally {
        isLoading = false;
    }
}

function displayCommunity(community) {
  const content = document.getElementById('community-content')
  if (!content) return

  const currentUserId = Number(localStorage.getItem('userId'))
  const subscribers = Array.isArray(community.subscribers)
    ? community.subscribers.map(Number)
    : []
  const moderators = Array.isArray(community.moderators)
    ? community.moderators.map(Number)
    : []
  const ownerId = Number(community.owner)
  const safeCommunityId = Number(community.id)
  const isSubscribed = subscribers.includes(currentUserId)
  const isOwner = ownerId === currentUserId
  const isModerator = moderators.includes(currentUserId)
  const canEdit = isOwner || isModerator
  const profilePicture = getSafeMediaUrl(
    community.profilePicture,
    '/default-avatar.jpg'
  )

  const header = createElement('div', 'profile-header')
  const headerContents = createElement('div', 'profile-header-contents')
  const headerLeft = createElement('div', 'profile-header-left')
  const pictureContainer = createElement('div', 'profile-pfp')
  const picture = createElement(
    'img',
    'profile-picture frutiger-aero-border'
  )
  picture.src = profilePicture
  picture.alt = `Изображение порта ${String(community.username || '')}`
  picture.style.borderRadius = '0'
  picture.style.border = '6px solid rgb(255 255 255)'
  picture.style.boxShadow = '4px 4px 18px #0000008f'
  picture.style.background = 'white'
  picture.style.cursor = 'pointer'
  picture.addEventListener('click', () => {
    if (typeof window.openProfilePicture === 'function') {
      window.openProfilePicture(profilePicture)
    }
  })
  pictureContainer.appendChild(picture)

  const buttons = createElement('div', 'profile-left-buttons')
  buttons.id = 'profile-buttons'
  const actionButton = createElement('button', 'profile-btn-btn')
  actionButton.type = 'button'
  actionButton.style.marginBottom = '55px'

  if (canEdit) {
    actionButton.textContent = 'Редактировать'
    actionButton.addEventListener('click', () => {
      if (Number.isSafeInteger(safeCommunityId) && safeCommunityId > 0) {
        window.location.href = `/community/settings?id=${safeCommunityId}`
      }
    })
  } else if (isSubscribed) {
    actionButton.textContent = 'Отключиться'
    actionButton.addEventListener('click', () => {
      unsubscribeFromCommunity(safeCommunityId)
    })
  } else {
    actionButton.textContent = 'Присоединиться'
    actionButton.addEventListener('click', () => {
      subscribeToCommunity(safeCommunityId)
    })
  }

  buttons.appendChild(actionButton)
  headerLeft.append(pictureContainer, buttons)

  const headerRight = createElement('div', 'profile-header-right')
  const nameContainer = createElement('div', 'profile-right-name')
  nameContainer.appendChild(
    createElement('p', '', community.username || 'Без названия')
  )
  headerRight.appendChild(nameContainer)

  if (community.status) {
    headerRight.appendChild(
      createElement('div', 'profile-right-status', community.status)
    )
  }
  if (community.description) {
    headerRight.appendChild(
      createElement(
        'div',
        'profile-right-description',
        community.description
      )
    )
  }

  headerRight.appendChild(
    createElement(
      'div',
      'community-header-right-type',
      community.type === 'page' ? 'Страница' : 'Сообщество'
    )
  )

  const createdAt = new Date(community.createdAt)
  const createdAtText = Number.isNaN(createdAt.getTime())
    ? 'неизвестно'
    : createdAt.toLocaleDateString('ru-RU')
  headerRight.appendChild(
    createElement(
      'div',
      'community-header-right-bday',
      `Порт создан: ${createdAtText}`
    )
  )

  const subscribersRow = createElement('div', 'community-header-subs')
  subscribersRow.append(
    createElement('label', '', 'Подписчиков:'),
    createElement('p', '', Number(community.subscriberCount) || 0)
  )
  headerRight.appendChild(subscribersRow)

  const rulesOpen = createElement(
    'button',
    'profile-header-morethings',
    'Правила'
  )
  rulesOpen.type = 'button'
  rulesOpen.addEventListener('click', openMore)

  headerContents.append(headerLeft, headerRight, rulesOpen)
  header.appendChild(headerContents)

  const neck = createElement('div', 'profile-neck')
  const neckLeft = createElement('div', 'profile-neck-left')
  const rulesList = createElement('ul', 'rules-list')
  rulesList.id = 'rules-list'
  renderRules(rulesList, community.rules)
  neckLeft.appendChild(rulesList)
  neck.append(neckLeft, createElement('div', 'profile-neck-right'))

  const rulesClose = createElement(
    'button',
    'profile-header-lessthings',
    'Скрыть'
  )
  rulesClose.type = 'button'
  rulesClose.addEventListener('click', closeMore)

  content.replaceChildren(header, neck, rulesClose)
}

function openMore() {
	const neck = document.querySelector('.profile-neck')
	neck.classList.add('open')
	const open = document.querySelector('.profile-header-morethings')
	open.style.transform = "scaleY(0)"
	const close = document.querySelector('.profile-header-lessthings')
	close.style.transform = "scaleY(1)"
	const somethings = document.querySelectorAll('.profile-header-somethings-thing');
	somethings.forEach(el => el.style.transform = "scaleY(0)");
}

function closeMore() {
	const neck = document.querySelector('.profile-neck')
	neck.classList.remove('open')
	const open = document.querySelector('.profile-header-morethings')
	open.style.transform = ''
	const close = document.querySelector('.profile-header-lessthings')
	close.style.transform = ''
	const somethings = document.querySelectorAll('.profile-header-somethings-thing');
	somethings.forEach(el => el.style.transform = '');
}

function renderRules(rulesList, rulesText) {
  const rules = typeof rulesText === 'string'
    ? rulesText.split('\n').map(rule => rule.trim()).filter(Boolean)
    : []

  if (rules.length === 0) {
    rulesList.replaceChildren(
      createElement('li', '', 'Правила не установлены')
    )
    return
  }

  rulesList.replaceChildren(
    ...rules.map(rule => createElement('li', '', rule))
  )
}

function displayRules(rulesText) {
  const rulesList = document.getElementById('rules-list')
  if (rulesList) renderRules(rulesList, rulesText)
}

async function subscribeToCommunity(targetCommunityId) {
  const userId = localStorage.getItem('userId')
  if (!userId) {
    window.location.href = '/login'
    return
  }
  if (!Number.isSafeInteger(targetCommunityId) || targetCommunityId <= 0) {
    alert('Некорректный идентификатор порта')
    return
  }

  try {
    const data = await fetchJson(
      `/api/communities/${targetCommunityId}/join`,
      { method: 'POST' }
    )
    if (!data.success) {
      throw new Error(data.error || 'Не удалось подписаться')
    }
    loadCommunity()
  } catch (err) {
    console.error('Error subscribing:', err)
    alert(`Ошибка: ${err.message || 'Ошибка сервера'}`)
  }
}

async function unsubscribeFromCommunity(targetCommunityId) {
  const userId = localStorage.getItem('userId')
  if (!userId) return
  if (!Number.isSafeInteger(targetCommunityId) || targetCommunityId <= 0) {
    alert('Некорректный идентификатор порта')
    return
  }

  try {
    const data = await fetchJson(
      `/api/communities/${targetCommunityId}/leave`,
      { method: 'POST' }
    )
    if (!data.success) {
      throw new Error(data.error || 'Не удалось отписаться')
    }
    loadCommunity()
  } catch (err) {
    console.error('Error unsubscribing:', err)
    alert(`Ошибка: ${err.message || 'Ошибка сервера'}`)
  }
}

// Scroll listener
function setupCommunityScrollListener() {
    window.addEventListener('scroll', () => {
        const scrollHeight = document.documentElement.scrollHeight;
        const scrollTop = window.scrollY;
        const clientHeight = window.innerHeight;
        
        if (scrollHeight - (scrollTop + clientHeight) < 300) {
            loadMoreCommunityPosts();
        }
    });
}

window.openMore = openMore
window.closeMore = closeMore
window.subscribeToCommunity = subscribeToCommunity
window.unsubscribeFromCommunity = unsubscribeFromCommunity
window.loadCommunity = loadCommunity

if (hasValidCommunityId) {
  loadCommunity()
  setupCommunityScrollListener()
}