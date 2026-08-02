// client.js
import * as PostDisplay from './display-post.js'

// Define lightbox functions FIRST
const lightbox = document.createElement('div')
lightbox.id = 'lightbox'
lightbox.style.display = 'none'
document.body.appendChild(lightbox)

function closeLightbox() {
  lightbox.style.display = 'none'
  lightbox.innerHTML = ''
  document.body.style.overflow = ''
}

function openLightbox(imagePath, mediaItems = null) {
  lightbox.style.display = 'flex'
  document.body.style.overflow = 'hidden'
  
  // Clear previous content
  lightbox.innerHTML = ''
  
  if (mediaItems && mediaItems.length > 1) {
    // Create carousel in lightbox
    const lightboxCarousel = document.createElement('div')
    lightboxCarousel.classList.add('lightbox-carousel')
    
    let currentIndex = mediaItems.findIndex(item => item.path === imagePath)
    if (currentIndex === -1) currentIndex = 0
    
    const updateLightboxDisplay = (index) => {
      lightboxCarousel.innerHTML = ''
      
      const item = mediaItems[index]
      let mediaElement
      
      if (item.type === 'image') {
        mediaElement = document.createElement('img')
        mediaElement.src = item.path
        mediaElement.classList.add('lightbox-media')
      } else if (item.type === 'video') {
        mediaElement = document.createElement('video')
        mediaElement.src = item.path
        mediaElement.controls = true
        mediaElement.classList.add('lightbox-media')
        mediaElement.autoplay = true
      }
      
      const prevBtn = document.createElement('button')
      prevBtn.classList.add('lightbox-nav', 'lightbox-prev')
      prevBtn.innerHTML = '←'
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        currentIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length
        updateLightboxDisplay(currentIndex)
      })
      
      const nextBtn = document.createElement('button')
      nextBtn.classList.add('lightbox-nav', 'lightbox-next')
      nextBtn.innerHTML = '→'
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        currentIndex = (currentIndex + 1) % mediaItems.length
        updateLightboxDisplay(currentIndex)
      })
      
      const counter = document.createElement('div')
      counter.classList.add('lightbox-counter')
      counter.textContent = `${currentIndex + 1} / ${mediaItems.length}`
      
      const closeBtn = document.createElement('span')
      closeBtn.classList.add('lightbox-close')
      closeBtn.innerHTML = '&times;'
      closeBtn.addEventListener('click', closeLightbox)
      
      lightboxCarousel.appendChild(prevBtn)
      lightboxCarousel.appendChild(mediaElement)
      lightboxCarousel.appendChild(nextBtn)
      lightboxCarousel.appendChild(counter)
      lightboxCarousel.appendChild(closeBtn)
      lightbox.appendChild(lightboxCarousel)
    }
    
    updateLightboxDisplay(currentIndex)
    
  } else {
    // Single image
    const img = document.createElement('img')
    img.src = imagePath
    img.classList.add('lightbox-single-img')
    
    const closeBtn = document.createElement('span')
    closeBtn.classList.add('lightbox-close')
    closeBtn.innerHTML = '&times;'
    closeBtn.addEventListener('click', closeLightbox)
    
    lightbox.appendChild(closeBtn)
    lightbox.appendChild(img)
  }
}

// CRITICAL: Attach to window AFTER functions are defined
window.openLightbox = openLightbox
window.closeLightbox = closeLightbox

// Global click to close (click on background)
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
  const username = sessionStorage.getItem('username')
  
  if (!username) return
  
  if (sessionStorage.getItem('userAvatar')) {
    updateNavAvatar(sessionStorage.getItem('userAvatar'))
    return
  }
  
  fetch(`/api/users/${username}`)
    .then(r => r.json())
    .then(user => {
      if (user && user.profilePicture) {
        sessionStorage.setItem('userAvatar', user.profilePicture)
        updateNavAvatar(user.profilePicture)
      } else {
        sessionStorage.setItem('userAvatar', '/default-avatar.jpg')
        updateNavAvatar('/default-avatar.jpg')
      }
    })
    .catch(err => {
      console.error('Error loading avatar:', err)
      sessionStorage.setItem('userAvatar', '/default-avatar.jpg')
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
})


async function loadAndDisplayPosts() {
  try {
    await PostDisplay.loadUserMap()
    
    const response = await fetch('/api/posts')
    const posts = await response.json()
    
    PostDisplay.displayPosts('feed', posts, loadAndDisplayPosts)
  } catch (err) {
    console.error('Error loading posts:', err)
  }
}

window.loadAndDisplayPosts = loadAndDisplayPosts

// Start the display
loadAndDisplayPosts()