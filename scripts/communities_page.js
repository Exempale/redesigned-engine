let communitiesIsSearchMode = false
let currentCommData = null
let viewingCommUserId = null
let communitySearchRequestId = 0

// Get DOM elements
const communitiesListContainer = document.getElementById('communities-list-container')
const communitySearchContainer = document.getElementById('community-search-container')
const communitySearchInput = document.getElementById('community-search-input')

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

function getPositiveId(value) {
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0 ? id : null
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

function createEmptyState(text) {
    const emptyState = createElement('div', '', text)
    emptyState.style.textAlign = 'center'
    emptyState.style.padding = '30px'
    emptyState.style.color = '#666'
    return emptyState
}

function createCommunityCard(comm, action) {
    const communityId = getPositiveId(comm?.id)
    if (!communityId) return null

    const card = createElement('div', 'friend-card')
    const avatar = createElement(
        'img',
        'friend-card-avatar frutiger-aero-border'
    )
    avatar.src = getSafeMediaUrl(
        comm.profilePicture,
        '/default-avatar.jpg'
    )
    avatar.alt = ''

    const info = createElement('div', 'friend-card-info')
    info.style.display = 'flex'
    info.style.flexDirection = 'column'
    info.style.gap = '4px'

    const name = createElement(
        'a',
        'friend-card-name',
        comm.username || 'Без названия'
    )
    name.href = `/community?id=${communityId}`
    info.append(
        name,
        createElement(
            'span',
            'friend-card-type',
            comm.type === 'community' ? 'сообщество' : 'страница'
        )
    )

    if (comm.subCount !== undefined) {
        const subCount = Number(comm.subCount) || 0
        info.appendChild(
            createElement(
                'span',
                'friend-card-subcount',
                `${subCount} ${
                    comm.type === 'community'
                        ? 'Участников'
                        : 'Подписчиков'
                }`
            )
        )
    }

    card.append(avatar, info)

    if (action === 'join' || action === 'leave') {
        const button = createElement(
            'button',
            'friend-card-btn',
            action === 'join' ? 'Подключиться' : 'Отключить'
        )
        button.type = 'button'
        button.addEventListener('click', () => {
            if (action === 'join') {
                joinCommunity(communityId)
            } else {
                leaveCommunity(communityId)
            }
        })
        card.appendChild(button)
    }

    return card
}

function loadCommData(userId) {
    let targetUserId = getPositiveId(userId)
    if (!targetUserId) {
        targetUserId = getPositiveId(localStorage.getItem('userId'))
        if (!targetUserId) {
            window.location.href = '/login'
            return
        }
    }

    viewingCommUserId = targetUserId
    const currentUserId = getPositiveId(localStorage.getItem('userId'))
    const isOwnProfile = targetUserId === currentUserId

const createButton = document.getElementById('create-community-button');
if (createButton) {
    createButton.style.display = isOwnProfile ? 'inline-block' : 'none';
}
    
    // Update header label
    const myPortsLabel = document.getElementById('myPorts')
    if (myPortsLabel) {
        if (isOwnProfile) {
            myPortsLabel.textContent = 'Мои порты'
        } else {
            fetchJson(`/api/users/${targetUserId}`)
                .then(user => {
                    myPortsLabel.textContent = `Порты ${
                        user?.username || 'пользователя'
                    }`
                })
                .catch(() => {
                    myPortsLabel.textContent = 'Порты пользователя'
                })
        }
    }
    
    // Hide search bar if not own profile
    if (communitySearchInput) {
        communitySearchInput.style.display = isOwnProfile ? 'block' : 'none'
    }
    
    // Choose correct endpoint
    const apiUrl = isOwnProfile
        ? `/api/user/communities/${targetUserId}`
        : `/api/users/${targetUserId}/communities`

    fetchJson(apiUrl)
        .then(data => {
            let communities = []
            if (isOwnProfile) {
                // Own profile: { communities: [...] }
                communities = data.communities || []
            } else {
                // Other profile: direct array
                communities = Array.isArray(data) ? data : []
            }
            // Store for search results (to know which ones are subscribed)
            currentCommData = { communities: communities }
            
            if (myPortsLabel && isOwnProfile) {
                myPortsLabel.textContent = `Мои порты (${communities.length})`
            }
            displayComms(communities, isOwnProfile)
        })
        .catch(err => {
            console.error('Error loading communities:', err)
            displayComms([], isOwnProfile)
        })
}

// Setup search
function setupSearch() {
    if (!communitySearchInput) return
    
    const currentUserId = parseInt(localStorage.getItem('userId'))
    if (viewingCommUserId && viewingCommUserId !== currentUserId) {
        communitySearchInput.style.display = 'none'
        return
    }
    
    communitySearchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim()
        if (query.length >= 1) {
            performCommunitySearch(query)
        } else if (query.length === 0) {
            exitCommunitySearchMode()
        }
    })
    
    communitySearchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const query = e.target.value.trim()
            if (query.length >= 1) {
                performCommunitySearch(query)
            }
        }
        if (e.key === 'Escape') {
            exitCommunitySearchMode()
            communitySearchInput.value = ''
        }
    })
}

function performCommunitySearch(query) {
    const normalizedQuery = String(query || '').trim()
    if (normalizedQuery.length < 2) return

    const requestId = ++communitySearchRequestId
    fetchJson(
        `/api/communities/search?q=${encodeURIComponent(normalizedQuery)}`
    )
        .then(communities => {
            if (requestId !== communitySearchRequestId) return
            displayCommunitySearchResults(
                Array.isArray(communities) ? communities : []
            )
            communitiesIsSearchMode = true

            if (communitiesListContainer) {
                communitiesListContainer.style.display = 'none'
            }
            if (communitySearchContainer) {
                communitySearchContainer.style.display = 'block'
            }
        })
        .catch(err => {
            if (requestId === communitySearchRequestId) {
                console.error('Search error:', err)
            }
        })
}

function exitCommunitySearchMode() {
    communitySearchRequestId += 1
    communitiesIsSearchMode = false
    if (communitiesListContainer) communitiesListContainer.style.display = 'block'
    if (communitySearchContainer) communitySearchContainer.style.display = 'none'
    if (communitySearchInput) communitySearchInput.value = ''
}

function displayCommunitySearchResults(communities) {
    const container = document.getElementById('community-search-list')
    if (!container) return

    container.replaceChildren()

    if (!Array.isArray(communities) || communities.length === 0) {
        container.appendChild(createEmptyState('Порты не найдены'))
        return
    }

    const subscribedCommunityIds = new Set(
        (currentCommData?.communities || [])
            .map(comm => getPositiveId(comm?.id))
            .filter(Boolean)
    )

    communities.forEach(comm => {
        const communityId = getPositiveId(comm?.id)
        const card = createCommunityCard(
            comm,
            subscribedCommunityIds.has(communityId) ? 'leave' : 'join'
        )
        if (card) container.appendChild(card)
    })
}

function displayComms(communities, showButtons = true) {
    const container = document.getElementById('communities-list')
    if (!container) return

    container.replaceChildren()

    if (!Array.isArray(communities) || communities.length === 0) {
        container.appendChild(
            createEmptyState(
                showButtons
                    ? 'Нет подключённых портов!'
                    : 'У пользователя нет портов'
            )
        )
        return
    }

    communities.forEach(comm => {
        const card = createCommunityCard(
            comm,
            showButtons ? 'leave' : null
        )
        if (card) container.appendChild(card)
    })
}

async function joinCommunity(communityId) {
    const userId = getPositiveId(localStorage.getItem('userId'))
    const targetCommunityId = getPositiveId(communityId)
    if (!userId) {
        window.location.href = '/login'
        return
    }
    if (!targetCommunityId) return

    try {
        const data = await fetchJson(
            `/api/communities/${targetCommunityId}/join`,
            { method: 'POST' }
        )
        if (!data.success) {
            throw new Error(data.error || 'Не удалось подключиться')
        }
        loadCommData(userId)
        exitCommunitySearchMode()
    } catch (err) {
        console.error('Error joining community:', err)
        alert(`Ошибка: ${err.message || 'Не удалось подключиться'}`)
    }
}

async function leaveCommunity(communityId) {
    const userId = getPositiveId(localStorage.getItem('userId'))
    const targetCommunityId = getPositiveId(communityId)
    if (!userId || !targetCommunityId) return
    if (!confirm('Отключиться от этого порта?')) return

    try {
        const data = await fetchJson(
            `/api/communities/${targetCommunityId}/leave`,
            { method: 'POST' }
        )
        if (!data.success) {
            throw new Error(data.error || 'Не удалось отключиться')
        }
        loadCommData(userId)
        if (communitiesIsSearchMode) exitCommunitySearchMode()
    } catch (err) {
        console.error('Error leaving community:', err)
        alert(`Ошибка: ${err.message || 'Не удалось отключиться'}`)
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search)
    const userIdParam = urlParams.get('id')
    const currentUserId = getPositiveId(localStorage.getItem('userId'))
    const targetUserId = getPositiveId(userIdParam) || currentUserId

    if (!targetUserId) {
        window.location.href = '/login'
        return
    }

    setupSearch()
    loadCommData(targetUserId)

    if (window.location.pathname.includes('/communities')) {
        fetchJson(`/api/users/bio/${targetUserId}`)
            .then(userBio => {
                const profileBackground = getSafeMediaUrl(
                    userBio?.profileBackground
                )
                document.body.style.backgroundImage = profileBackground
                    ? `url("${profileBackground.replace(/"/g, '%22')}")`
                    : ''
            })
            .catch(() => {})
    }
})

// Make functions global
window.leaveCommunity = leaveCommunity
window.joinCommunity = joinCommunity
window.exitCommunitySearchMode = exitCommunitySearchMode