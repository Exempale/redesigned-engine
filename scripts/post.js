// post.js - Universal post creator

let selectedFiles = [];
let fileTypes = [];

async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > 1200) {
                    height = (height * 1200) / width;
                    width = 1200;
                }
                if (height > 1200) {
                    width = (width * 1200) / height;
                    height = 1200;
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob((blob) => {
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', 0.8);
            };
        };
    });
}

function togglePreviewVisibility() {
    const previewArea = document.getElementById('files-preview-area');
    if (previewArea) {
        const hasFiles = previewArea.children.length > 0;
        const hasPoll = window.pendingPoll !== null;
        previewArea.style.display = (hasFiles || hasPoll) ? 'flex' : 'none';
    }
}

function toggleSpoilerTextarea() {
    const spoilerTextarea = document.getElementById('spoiler-textarea');
    if (spoilerTextarea.style.display == 'none') {
        spoilerTextarea.style.display = 'block';
    } else {
        spoilerTextarea.style.display = 'none';
    }
}

function removeFile(event) {
    const index = event.target.dataset.index;
    selectedFiles.splice(index, 1);
    fileTypes.splice(index, 1);
    
    const previewArea = document.getElementById('files-preview-area');
    if (!previewArea) return;
    
    previewArea.innerHTML = '';
    
    selectedFiles.forEach((file, i) => {
        const type = fileTypes[i] || (typeof file === 'string' ? 'image' : file.type?.split('/')[0] || 'image');
        
        const previewItem = document.createElement('div');
        previewItem.classList.add('preview-item');
        
        // Handle string paths
        if (typeof file === 'string') {
            if (type === 'gif' || type === 'image') {
                previewItem.classList.add('image-preview');
                const img = document.createElement('img');
                img.src = file;
                previewItem.appendChild(img);
            } else if (type === 'video') {
                previewItem.classList.add('video-preview');
                const video = document.createElement('video');
                video.src = file;
                video.controls = true;
                previewItem.appendChild(video);
            } else if (type === 'audio') {
                previewItem.classList.add('audio-preview');
                const placeholder = document.createElement('div');
                placeholder.classList.add('audio-placeholder');
                placeholder.textContent = '🎵 Аудио';
                previewItem.appendChild(placeholder);
            }
        } else if (file && file.type === 'existing') {
            // Existing library file object
            const path = file.path;
            const fileType = file.fileType;
            if (fileType === 'gif' || fileType === 'image') {
                previewItem.classList.add('image-preview');
                const img = document.createElement('img');
                img.src = path;
                previewItem.appendChild(img);
            } else if (fileType === 'video') {
                previewItem.classList.add('video-preview');
                const video = document.createElement('video');
                video.src = path;
                video.controls = true;
                previewItem.appendChild(video);
            } else if (fileType === 'audio') {
                previewItem.classList.add('audio-preview');
                const placeholder = document.createElement('div');
                placeholder.classList.add('audio-placeholder');
                placeholder.textContent = '🎵 Аудио';
                previewItem.appendChild(placeholder);
            }
        } else {
            // Regular File object
            const isGif = file.type === 'image/gif';
            if (isGif || type === 'image') {
                previewItem.classList.add('image-preview');
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                previewItem.appendChild(img);
            } else if (type === 'video') {
                previewItem.classList.add('video-preview');
                const video = document.createElement('video');
                video.src = URL.createObjectURL(file);
                video.controls = true;
                previewItem.appendChild(video);
            } else if (type === 'audio') {
                previewItem.classList.add('audio-preview');
                const placeholder = document.createElement('div');
                placeholder.classList.add('audio-placeholder');
                placeholder.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
                previewItem.appendChild(placeholder);
            }
        }
        
        const removeBtn = document.createElement('button');
        removeBtn.classList.add('remove-file');
        removeBtn.innerHTML = '×';
        removeBtn.dataset.index = i;
        removeBtn.addEventListener('click', removeFile);
        
        previewItem.appendChild(removeBtn);
        previewArea.appendChild(previewItem);
    });
    
    togglePreviewVisibility();
}

function makePostCreator() {
    const currentUserId = localStorage.getItem('userId');
    if (!currentUserId) return;

    if (document.getElementById('new-post-fab')) {
        return; 
    }

    const path = window.location.pathname;
    const isCommunityPage = path.includes('/community');
    const isProfilePage = path.includes('/profile');
    const isMainPage = path === '/' || path.includes('/main');

    let skipDropdown = false;
    let communityId = null;
    
    if (isCommunityPage && window.communityPageData) {
        skipDropdown = true;
        communityId = window.communityPageData.communityId;

        if (!window.communityPageData.canPost) {
            return;
        }
    }
    
    if (isProfilePage) {
        skipDropdown = true;
    }

    // Create the HTML
    const postHTML = `
        <!-- NEW POST FLOATING BUTTON -->
        <button id="new-post-fab" class="new-post-fab"><img src="/ui/icons/new_post.webp"></button>
        
        <!-- NEW POST OVERLAY (hidden by default) -->
        <div id="new-post-overlay" class="new-post-overlay" style="display:none;">
            <div class="new-post-modal" style="position:fixed;">
                <button class="chat-exit-btn" id="new-post-close">×</button>
                <button id="post-button" class="postbutton send-button">Отправить!</button>
                <div class="new-post-modal-body">
                    <div class="creator-user-info">
                        <img src="" class="creator-avatar frutiger-aero-border" id="creator-avatar">
                        <div style="display:flex; flex-direction:column; top:-10px; position:relative;">
                            <span class="creator-username" id="creator-username"></span>
                            <div id="community-dropdown-container">
                                Новый пост в: 
                                <select class="creator-community-dropdown" id="creator-community">
                                    <option value="">Свой профиль</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display:flex; flex-direction:row; align-items:flex-end; justify-content:space-between;">
                        <div>
                            <span class="anonymous-text">Анонимно</span>
                            <input type="checkbox" id="anonymous-toggle" class="anonymous-checkbox">
                        </div>
                        <div>
                            <span class="anonymous-text">Спойлер</span>
                            <input type="checkbox" id="spoiler-toggle" class="anonymous-checkbox" onclick="toggleSpoilerTextarea()">
                        </div>
                        <div>
                            <span class="anonymous-text">18+</span>
                            <input type="checkbox" id="nsfw-toggle" class="anonymous-checkbox">
                        </div>
                    </div>
                    
                    <div class="post-creator-text-row" style="width:100%; margin-top:10px;">
                        <textarea id="spoiler-textarea" rows="1" placeholder="Текст предупреждающий о спойлере" class="post-creator-textarea" style="display:none;"></textarea>
                    </div>
                    
                    <div class="post-creator-text-row">
                        <textarea id="post-input" rows="6" placeholder="Умные мысли, и даже не очень..." class="post-creator-textarea"></textarea>
                    </div>
                    
                    <div class="post-creator-files-row">
                        <div class="add-button-container">
    <button class="postbutton add-btn" id="add-btn">Добавить</button>
    <div class="add-dropdown" id="add-dropdown" style="display:none;">
        <button class="add-option" data-type="photo">Фотография</button>
        <button class="add-option" data-type="video">Видеозапись</button>
        <button class="add-option" data-type="audio">Аудиозапись</button>
        <button class="add-option" data-type="poll">Опрос</button>
        <button class="add-option" data-type="gif">GIF</button>
    </div>
</div>
                        <input type="file" id="post-files" multiple style="display:none;" accept="image/*,video/*,audio/*">
                        <div class="files-preview-area" id="files-preview-area"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Append to body
    document.body.insertAdjacentHTML('beforeend', postHTML);

    // If on community page or profile page, hide the dropdown container
    if (skipDropdown) {
        const dropdownContainer = document.getElementById('community-dropdown-container');
        if (dropdownContainer) {
            dropdownContainer.style.display = 'none';
        }
    }

    
    const creatorAvatar = document.getElementById('creator-avatar');
    const creatorUsername = document.getElementById('creator-username');

	let displayName = localStorage.getItem('username');
	let displayAvatar = localStorage.getItem('userAvatar') || '/default-avatar.jpg';

	if (isCommunityPage && communityPageData) {
	    displayName = communityPageData.communityName || displayName;
	    displayAvatar = communityPageData.communityAvatar || displayAvatar;
	}

    if (creatorAvatar) creatorAvatar.src = displayAvatar;
    if (creatorUsername) creatorUsername.textContent = displayName;

    // --- Event Listeners ---

    // FAB button - show overlay
    const fab = document.getElementById('new-post-fab');
    if (fab) {
        fab.addEventListener('click', () => {
            document.getElementById('new-post-overlay').style.display = 'flex';
            document.body.style.overflow = 'hidden';
        });
    }

    // Close button - hide overlay
    const closeBtn = document.getElementById('new-post-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('new-post-overlay').style.display = 'none';
            document.body.style.overflow = '';
            resetPostForm();
        });
    }

    // Click on overlay background - hide overlay
    const overlay = document.getElementById('new-post-overlay');
    if (overlay) {
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
                document.body.style.overflow = '';
                resetPostForm();
            }
        });
    }

    // File selection
    const fileSelectBtn = document.getElementById('file-select-btn');
    const postFiles = document.getElementById('post-files');
    
    if (fileSelectBtn && postFiles) {
        fileSelectBtn.addEventListener('click', () => {
            postFiles.click();
        });
        postFiles.addEventListener('change', handleFileSelect);
    }

// Add button dropdown
const addBtn = document.getElementById('add-btn');
const addDropdown = document.getElementById('add-dropdown');

if (addBtn && addDropdown) {
    let hoverTimeout = null;
    
    // Open on hover (with small delay to prevent accidental opens)
    addBtn.addEventListener('mouseenter', () => {
        clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(() => {
            addDropdown.style.display = 'block';
        }, 150);
    });
    
    // Close on mouseleave - check if mouse is within 80px of button
    addBtn.addEventListener('mouseleave', (e) => {
    clearTimeout(hoverTimeout);
    
    // Get dropdown position
    const dropdownRect = addDropdown.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Calculate distance from mouse to dropdown center
    const centerX = dropdownRect.left + dropdownRect.width / 2;
    const centerY = dropdownRect.top + dropdownRect.height / 2;
    const distance = Math.sqrt(Math.pow(mouseX - centerX, 2) + Math.pow(mouseY - centerY, 2));
    
    if (distance < 180) {
        // Mouse is within 80px of dropdown, keep open
        addDropdown.style.display = 'block';
        return;
    }
    
    hoverTimeout = setTimeout(() => {
        if (!addDropdown.matches(':hover')) {
            addDropdown.style.display = 'none';
        }
    }, 200);
});
    
    // Keep dropdown open when hovering over it
    addDropdown.addEventListener('mouseenter', () => {
        clearTimeout(hoverTimeout);
        addDropdown.style.display = 'block';
    });
    
    addDropdown.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(() => {
            addDropdown.style.display = 'none';
        }, 200);
    });
    
    // Click toggles instantly (overrides hover)
    addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(hoverTimeout);
    const isVisible = addDropdown.style.display === 'block';
    // Only close if it's already open - otherwise open it
    if (isVisible) {
        // Do nothing - keep it open
        return;
    }
    addDropdown.style.display = 'block';
});
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        addDropdown.style.display = 'none';
    });
    
    // Don't close when clicking inside dropdown
    addDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    // Handle option clicks
    const options = addDropdown.querySelectorAll('.add-option');
    options.forEach(option => {
        option.addEventListener('click', () => {
            const type = option.dataset.type;
            addDropdown.style.display = 'none';
            switch(type) {
                case 'photo':
                    addMakePhoto();
                    break;
                case 'video':
                    addMakeVideo();
                    break;
                case 'audio':
                    addMakeAudio();
                    break;
                case 'poll':
                    addMakePoll();
                    break;
                case 'gif':
                    addMakeGIF();
                    break;
            }
        });
    });
}

    // Post button
    const postButton = document.getElementById('post-button');
    if (postButton) {
        postButton.addEventListener('click', createPost);
    }

    // Enter key support
    const postInput = document.getElementById('post-input');
    if (postInput) {
        postInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                if (!isMobile) {
                    e.preventDefault();
                    const postBtn = document.getElementById('post-button');
                    if (postBtn) postBtn.click();
                }
            }
        });
    }

    // Paste support
    setupPasteSupport();

    // Load communities for dropdown (only if not hidden)
    if (!skipDropdown) {
        loadUserCommunities(currentUserId);
    }
}

// ===== ADD FUNCTIONS =====

function addMakePhoto() {
    const overlay = document.createElement('div');
    overlay.className = 'add-lightbox-overlay';
    overlay.innerHTML = `
        <div class="add-lightbox add-lightbox-media">
            <button class="add-lightbox-close">×</button>
            <h3>Добавить фотографию</h3>
            <div class="add-lightbox-body">
                <div class="add-lightbox-upload-row">
                    <button class="postbutton add-upload-btn" id="photo-upload-btn">Загрузить...</button>
                    <input type="file" id="photo-upload" accept="image/*" multiple style="display:none;">
                </div>
                <div class="add-lightbox-grid" id="photo-grid">
                    <div class="add-lightbox-loading">Загрузка...</div>
                </div>
                <div class="add-lightbox-dropzone-overlay" id="photo-dropzone-overlay" style="display:none;">
                    <div class="add-lightbox-dropzone-content">
                        <span>📁 Перетащите файл сюда</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.add-lightbox-close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    const fileInput = overlay.querySelector('#photo-upload');
    const uploadBtn = overlay.querySelector('#photo-upload-btn');
    const grid = overlay.querySelector('#photo-grid');
    const dropzoneOverlay = overlay.querySelector('#photo-dropzone-overlay');

    // Upload button opens file picker
    uploadBtn.addEventListener('click', () => fileInput.click());

    // File selection - append and close
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('image');
                addFilePreview(file, 'image');
            });
            overlay.remove();
        }
    });

    // Load existing photos
    const currentUserId = localStorage.getItem('userId');
    if (currentUserId) {
        fetch(`/api/users/photos?userId=${currentUserId}`)
            .then(r => r.json())
            .then(data => {
                grid.innerHTML = '';
                if (data.photos && data.photos.length > 0) {
                    data.photos.forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = 'add-lightbox-grid-item';
    item.innerHTML = `
        <img src="${photo.file_path}" loading="lazy">
    `;
    item.onclick = function() {
	const routePath = `/photo/${photo.id}`;
        selectedFiles.push(routePath);
        fileTypes.push('image');
        addFilePreview(photo.file_path, 'image');
        overlay.remove();
    };
    grid.appendChild(item);
});
                } else {
                    grid.innerHTML = '<div class="add-lightbox-empty">Нет сохранённых фотографий</div>';
                }
            })
            .catch(() => {
                grid.innerHTML = '<div class="add-lightbox-empty">Ошибка загрузки</div>';
            });
    } else {
        grid.innerHTML = '<div class="add-lightbox-empty">Войдите, чтобы увидеть сохранённые фото</div>';
    }

    // Drag and drop
    let dragCounter = 0;
    overlay.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropzoneOverlay.style.display = 'flex';
    });
    overlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropzoneOverlay.style.display = 'none';
        }
    });
    overlay.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzoneOverlay.style.display = 'none';
        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length > 0) {
            imageFiles.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('image');
                addFilePreview(file, 'image');
            });
            overlay.remove();
        } else {
            alert('Пожалуйста, перетащите изображения');
        }
    });
}

function addMakeVideo() {
    const overlay = document.createElement('div');
    overlay.className = 'add-lightbox-overlay';
    overlay.innerHTML = `
        <div class="add-lightbox add-lightbox-media">
            <button class="add-lightbox-close">×</button>
            <h3>Добавить видеозапись</h3>
            <div class="add-lightbox-body">
                <div class="add-lightbox-upload-row">
                    <button class="postbutton add-upload-btn" id="video-upload-btn">Загрузить...</button>
                    <input type="file" id="video-upload" accept="video/*" multiple style="display:none;">
                </div>
                <div class="add-lightbox-grid" id="video-grid">
                    <div class="add-lightbox-loading">Загрузка...</div>
                </div>
                <div class="add-lightbox-dropzone-overlay" id="video-dropzone-overlay" style="display:none;">
                    <div class="add-lightbox-dropzone-content">
                        <span>📁 Перетащите файл сюда</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.add-lightbox-close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    const fileInput = overlay.querySelector('#video-upload');
    const uploadBtn = overlay.querySelector('#video-upload-btn');
    const grid = overlay.querySelector('#video-grid');
    const dropzoneOverlay = overlay.querySelector('#video-dropzone-overlay');

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('video');
                addFilePreview(file, 'video');
            });
            overlay.remove();
        }
    });

    const currentUserId = localStorage.getItem('userId');
    if (currentUserId) {
        fetch(`/api/users/videos?userId=${currentUserId}`)
            .then(r => r.json())
            .then(data => {
                grid.innerHTML = '';
                if (data.videos && data.videos.length > 0) {
                    data.videos.forEach((video, index) => {
    const item = document.createElement('div');
    item.className = 'add-lightbox-grid-item add-lightbox-grid-item-video';
    item.innerHTML = `
        <video src="${video.file_path}" muted preload="metadata"></video>
    `;
    const videoEl = item.querySelector('video');
    videoEl.addEventListener('mouseenter', () => videoEl.play());
    videoEl.addEventListener('mouseleave', () => videoEl.pause());
    item.onclick = function() {
    	const routePath = `/video/${video.id}`;
    	selectedFiles.push(routePath);
        fileTypes.push('video');
        addFilePreview(video.file_path, 'video');
        overlay.remove();
    };
    grid.appendChild(item);
});
                } else {
                    grid.innerHTML = '<div class="add-lightbox-empty">Нет сохранённых видео</div>';
                }
            })
            .catch(() => {
                grid.innerHTML = '<div class="add-lightbox-empty">Ошибка загрузки</div>';
            });
    } else {
        grid.innerHTML = '<div class="add-lightbox-empty">Войдите, чтобы увидеть сохранённые видео</div>';
    }

    // Drag and drop
    let dragCounter = 0;
    overlay.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropzoneOverlay.style.display = 'flex';
    });
    overlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropzoneOverlay.style.display = 'none';
        }
    });
    overlay.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzoneOverlay.style.display = 'none';
        const files = Array.from(e.dataTransfer.files);
        const videoFiles = files.filter(f => f.type.startsWith('video/'));
        if (videoFiles.length > 0) {
            videoFiles.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('video');
                addFilePreview(file, 'video');
            });
            overlay.remove();
        } else {
            alert('Пожалуйста, перетащите видеофайлы');
        }
    });
}

function addMakeAudio() {
    const overlay = document.createElement('div');
    overlay.className = 'add-lightbox-overlay';
    overlay.innerHTML = `
        <div class="add-lightbox add-lightbox-media">
            <button class="add-lightbox-close">×</button>
            <h3>Добавить аудиозапись</h3>
            <div class="add-lightbox-body">
                <div class="add-lightbox-upload-row">
                    <button class="postbutton add-upload-btn" id="audio-upload-btn">Загрузить...</button>
                    <input type="file" id="audio-upload" accept="audio/*" multiple style="display:none;">
                </div>
                <div class="add-lightbox-grid-audio" id="audio-grid">
                    <div class="add-lightbox-loading">Загрузка...</div>
                </div>
                <div class="add-lightbox-dropzone-overlay" id="audio-dropzone-overlay" style="display:none;">
                    <div class="add-lightbox-dropzone-content">
                        <span>📁 Перетащите файл сюда</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.add-lightbox-close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    const fileInput = overlay.querySelector('#audio-upload');
    const uploadBtn = overlay.querySelector('#audio-upload-btn');
    const grid = overlay.querySelector('#audio-grid');
    const dropzoneOverlay = overlay.querySelector('#audio-dropzone-overlay');

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('audio');
                addFilePreview(file, 'audio');
            });
            overlay.remove();
        }
    });

    const currentUserId = localStorage.getItem('userId');
    if (currentUserId) {
        fetch(`/api/users/audios?userId=${currentUserId}`)
            .then(r => r.json())
            .then(data => {
                grid.innerHTML = '';
                if (data.audios && data.audios.length > 0) {
                    data.audios.forEach((audio, index) => {
    const item = document.createElement('div');
    item.className = 'add-lightbox-grid-item-audio';
    item.innerHTML = `
        <span class="audio-order">${index + 1}</span>
        <div class="audio-info">
            <span class="audio-name">${audio.name || 'Без названия'}</span>
            <span class="audio-artist">${audio.artist_name || 'Неизвестно'}</span>
        </div>
        <span class="audio-length">--:--</span>
    `;
    item.onclick = function() {
    	const routePath = `/audio/${audio.id}`;
    	selectedFiles.push(routePath);
        fileTypes.push('audio');
        addFilePreview(audio.file_path, 'audio');
        overlay.remove();
    };
    grid.appendChild(item);
});
                } else {
                    grid.innerHTML = '<div class="add-lightbox-empty">Нет сохранённых аудиозаписей</div>';
                }
            })
            .catch(() => {
                grid.innerHTML = '<div class="add-lightbox-empty">Ошибка загрузки</div>';
            });
    } else {
        grid.innerHTML = '<div class="add-lightbox-empty">Войдите, чтобы увидеть сохранённые аудиозаписи</div>';
    }

    let dragCounter = 0;
    overlay.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropzoneOverlay.style.display = 'flex';
    });
    overlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropzoneOverlay.style.display = 'none';
        }
    });
    overlay.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzoneOverlay.style.display = 'none';
        const files = Array.from(e.dataTransfer.files);
        const audioFiles = files.filter(f => f.type.startsWith('audio/'));
        if (audioFiles.length > 0) {
            audioFiles.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('audio');
                addFilePreview(file, 'audio');
            });
            overlay.remove();
        } else {
            alert('Пожалуйста, перетащите аудиофайлы');
        }
    });
}

function addMakePoll() {
    const overlay = document.createElement('div');
    overlay.className = 'add-lightbox-overlay';
    overlay.innerHTML = `
        <div class="add-lightbox">
            <button class="add-lightbox-close">×</button>
            <h3>Создать опрос</h3>
            <div class="add-lightbox-body" style="padding: 20px; gap: 25px; display: flex; flex-direction: column;">
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <label style="font-weight: bold; font-size: 14px; text-align: center">Заголовок</label>
                    <input type="text" id="poll-title-input" placeholder="Яблоки или кирпичи..." style="padding: 10px; border: 2px solid #8FDADB; border-radius: 8px; font-size: 14px;">
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <label style="font-weight: bold; font-size: 14px; text-align: center">Варианты ответа</label>
                    <div id="poll-choices-container" style="display: flex; flex-direction: column; gap: 8px;">
                        <div class="poll-choice-row" style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" class="poll-choice-input" placeholder="Вариант 1" style="flex: 1; padding: 8px; border: 2px solid #8FDADB; border-radius: 8px; font-size: 14px;">
                            <button class="poll-remove-choice" style="display: none; background: none; border: none; color: #ff4444; font-size: 20px; cursor: pointer;">×</button>
                        </div>
                        <div class="poll-choice-row" style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" class="poll-choice-input" placeholder="Вариант 2" style="flex: 1; padding: 8px; border: 2px solid #8FDADB; border-radius: 8px; font-size: 14px;">
                            <button class="poll-remove-choice" style="display: none; background: none; border: none; color: #ff4444; font-size: 20px; cursor: pointer;">×</button>
                        </div>
                    </div>
                    <button id="poll-add-choice-btn" class="postbutton" style="align-self: flex-start; padding: 6px 16px; font-size: 13px;">+ Добавить вариант</button>
                </div>
                
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="checkbox" id="poll-multi-choice">
                    <label style="font-weight: bold; font-size: 14px;">Выбрать несколько</label>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <label style="font-weight: bold; font-size: 14px;">Срок действия (опционально)</label>
                    <input type="datetime-local" id="poll-expires-input" style="padding: 8px; border: 2px solid #8FDADB; border-radius: 8px; font-size: 14px;">
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 10px; justify-content: flex-end;">
                    <button id="poll-cancel-btn" class="postbutton" style="background: linear-gradient(208deg, rgba(132, 123, 232, 0.5) 0%, rgba(190, 199, 255, 0.5) 100%); border-color: 2px solid #626ec5;">Отмена</button>
                    <button id="poll-create-btn" class="postbutton" style="border: 2px solid #76c8c9;">Создать опрос</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.add-lightbox-close');
    const titleInput = overlay.querySelector('#poll-title-input');
    const choicesContainer = overlay.querySelector('#poll-choices-container');
    const addChoiceBtn = overlay.querySelector('#poll-add-choice-btn');
    const multiChoiceCheckbox = overlay.querySelector('#poll-multi-choice');
    const expiresInput = overlay.querySelector('#poll-expires-input');
    const createBtn = overlay.querySelector('#poll-create-btn');
    const cancelBtn = overlay.querySelector('#poll-cancel-btn');

    // Add choice row
    function addChoiceRow(text = '') {
        const row = document.createElement('div');
        row.className = 'poll-choice-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-choice-input';
        input.placeholder = `Вариант ${choicesContainer.children.length + 1}`;
        input.value = text;
        input.style.cssText = 'flex: 1; padding: 8px; border: 2px solid #8FDADB; border-radius: 8px; font-size: 14px;';
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'poll-remove-choice';
        removeBtn.textContent = '×';
        removeBtn.style.cssText = 'background: none; border: none; color: #ff4444; font-size: 20px; cursor: pointer;';
        removeBtn.style.display = choicesContainer.children.length > 2 ? 'block' : 'none';
        removeBtn.onclick = function() {
            if (choicesContainer.children.length <= 2) {
                alert('Минимум 2 варианта');
                return;
            }
            row.remove();
            updatePlaceholders();
        };
        
        row.appendChild(input);
        row.appendChild(removeBtn);
        choicesContainer.appendChild(row);
        updatePlaceholders();
        input.focus();
    }

    function updatePlaceholders() {
        const rows = choicesContainer.querySelectorAll('.poll-choice-row');
        rows.forEach((row, index) => {
            const input = row.querySelector('.poll-choice-input');
            input.placeholder = `Вариант ${index + 1}`;
            const removeBtn = row.querySelector('.poll-remove-choice');
            removeBtn.style.display = rows.length > 2 ? 'block' : 'none';
        });
    }

    // Add choice button
    addChoiceBtn.addEventListener('click', () => {
        if (choicesContainer.children.length >= 10) {
            alert('Максимум 10 вариантов');
            return;
        }
        addChoiceRow();
    });

    // Cancel
    cancelBtn.addEventListener('click', () => overlay.remove());
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // Create poll
    createBtn.addEventListener('click', () => {
        const title = titleInput.value.trim();
        if (!title) {
            alert('Введите вопрос');
            return;
        }
        
        const choiceInputs = choicesContainer.querySelectorAll('.poll-choice-input');
        const choices = [];
        let hasEmpty = false;
        choiceInputs.forEach(input => {
            const text = input.value.trim();
            if (!text) {
                hasEmpty = true;
            } else {
                choices.push(text);
            }
        });
        
        if (hasEmpty) {
            alert('Заполните все варианты или удалите пустые');
            return;
        }
        
        if (choices.length < 2) {
            alert('Минимум 2 варианта');
            return;
        }
        
        const multiChoice = multiChoiceCheckbox.checked;
        let expiresAt = null;
        if (expiresInput.value) {
            expiresAt = Math.floor(new Date(expiresInput.value).getTime() / 1000);
        }
        
        const pollData = {
            title: title,
            choices: choices.map(text => ({ text })),
            multiple_choice: multiChoice,
            expires_at: expiresAt
        };
        
        // Store poll data on the window so it can be sent with the post
        window.pendingPoll = pollData;
        
        // Show in preview area
        addPollPreview(pollData);
        
        overlay.remove();
    });

    // Enter key support
    titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstInput = choicesContainer.querySelector('.poll-choice-input');
            if (firstInput) firstInput.focus();
        }
    });
    
    choicesContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('poll-choice-input')) {
            e.preventDefault();
            addChoiceRow();
        }
    });

    // Initial focus
    setTimeout(() => titleInput.focus(), 100);
}

function addPollPreview(pollData) {
    // Remove existing poll preview if any
    const existing = document.querySelector('.poll-preview-item');
    if (existing) existing.remove();
    
    const previewArea = document.getElementById('files-preview-area');
    if (!previewArea) return;
    
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item poll-preview-item';
    previewItem.style.cssText = 'min-width: 200px; max-width: 300px; padding: 12px; background: #f0f8ff; border: 2px solid #8FDADB; border-radius: 12px;';
    
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: bold; font-size: 14px; margin-bottom: 6px;';
    title.textContent = pollData.title;
    previewItem.appendChild(title);
    
    const choicesPreview = document.createElement('div');
    choicesPreview.style.cssText = 'font-size: 13px; color: #555;';
    choicesPreview.textContent = pollData.choices.map(c => '• ' + c.text).join('  ');
    previewItem.appendChild(choicesPreview);
    
    const multiText = document.createElement('div');
    multiText.style.cssText = 'font-size: 12px; color: #888; margin-top: 4px;';
    multiText.textContent = pollData.multiple_choice ? 'Множественный выбор' : 'Одиночный выбор';
    previewItem.appendChild(multiText);
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-file';
    removeBtn.innerHTML = '×';
    removeBtn.style.cssText = 'position: absolute; top: -8px; right: -8px; background: #ff4444; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;';
    removeBtn.onclick = function(e) {
        e.stopPropagation();
        window.pendingPoll = null;
        previewItem.remove();
        togglePreviewVisibility();
    };
    
    previewItem.style.position = 'relative';
    previewItem.appendChild(removeBtn);
    previewArea.appendChild(previewItem);
    togglePreviewVisibility();
}

function addMakeGIF() {
    const overlay = document.createElement('div');
    overlay.className = 'add-lightbox-overlay';
    overlay.innerHTML = `
        <div class="add-lightbox add-lightbox-media">
            <button class="add-lightbox-close">×</button>
            <h3>Добавить GIF</h3>
            <div class="add-lightbox-body">
                <div class="add-lightbox-upload-row">
                    <button class="postbutton add-upload-btn" id="gif-upload-btn">Загрузить...</button>
                    <input type="file" id="gif-upload" accept="image/gif" multiple style="display:none;">
                </div>
                <div class="add-lightbox-grid" id="gif-grid">
                    <div class="add-lightbox-loading">Загрузка...</div>
                </div>
                <div class="add-lightbox-dropzone-overlay" id="gif-dropzone-overlay" style="display:none;">
                    <div class="add-lightbox-dropzone-content">
                        <span>📁 Перетащите файл сюда</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.add-lightbox-close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    const fileInput = overlay.querySelector('#gif-upload');
    const uploadBtn = overlay.querySelector('#gif-upload-btn');
    const grid = overlay.querySelector('#gif-grid');
    const dropzoneOverlay = overlay.querySelector('#gif-dropzone-overlay');

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('gif');
                addFilePreview(file, 'gif');
            });
            overlay.remove();
        }
    });

    const currentUserId = localStorage.getItem('userId');
    if (currentUserId) {
        fetch(`/api/users/gifs?userId=${currentUserId}`)
            .then(r => r.json())
            .then(data => {
                grid.innerHTML = '';
                if (data.gifs && data.gifs.length > 0) {
                    data.gifs.forEach((gif, index) => {
    const item = document.createElement('div');
    item.className = 'add-lightbox-grid-item';
    item.innerHTML = `
        <img src="${gif.file_path}" loading="lazy">
    `;
    item.onclick = function() {
    	const routePath = `/photo/${gif.id}`;
    	selectedFiles.push(routePath);
        fileTypes.push('gif');
        addFilePreview(gif.file_path, 'gif');
        overlay.remove();
    };
    grid.appendChild(item);
});
                } else {
                    grid.innerHTML = '<div class="add-lightbox-empty">Нет сохранённых GIF</div>';
                }
            })
            .catch(() => {
                grid.innerHTML = '<div class="add-lightbox-empty">Ошибка загрузки</div>';
            });
    } else {
        grid.innerHTML = '<div class="add-lightbox-empty">Войдите, чтобы увидеть сохранённые GIF</div>';
    }

    let dragCounter = 0;
    overlay.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropzoneOverlay.style.display = 'flex';
    });
    overlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropzoneOverlay.style.display = 'none';
        }
    });
    overlay.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzoneOverlay.style.display = 'none';
        const files = Array.from(e.dataTransfer.files);
        const gifFiles = files.filter(f => f.type === 'image/gif');
        if (gifFiles.length > 0) {
            gifFiles.forEach(file => {
                selectedFiles.push(file);
                fileTypes.push('gif');
                addFilePreview(file, 'gif');
            });
            overlay.remove();
        } else {
            alert('Пожалуйста, перетащите GIF-файлы');
        }
    });
}

// Helper function to add file preview to main preview area
function addFilePreview(file, type) {
    const previewArea = document.getElementById('files-preview-area');
    if (!previewArea) return;
    
    const previewItem = document.createElement('div');
    previewItem.classList.add('preview-item');
    
    // If file is a string (existing file path from server)
    if (typeof file === 'string') {
        // Check if it's a metadata route or direct path
        let displayPath = file;
        if (file.startsWith('/photo/') || file.startsWith('/video/') || file.startsWith('/audio/')) {
            displayPath = file;
        }
        
        if (type === 'gif' || type === 'image') {
            previewItem.classList.add('image-preview');
            const img = document.createElement('img');
            img.src = displayPath;
            previewItem.appendChild(img);
        } else if (type === 'video') {
            previewItem.classList.add('video-preview');
            const video = document.createElement('video');
            video.src = displayPath;
            video.controls = true;
            previewItem.appendChild(video);
        } else if (type === 'audio') {
            previewItem.classList.add('audio-preview');
            const placeholder = document.createElement('div');
            placeholder.classList.add('audio-placeholder');
            placeholder.textContent = '🎵 Аудио';
            previewItem.appendChild(placeholder);
        }
    } else {
        // File object from input - check if it's a special object
        if (file && file.type === 'existing') {
            // It's an existing library file
            const path = file.path;
            const fileType = file.fileType;
            if (fileType === 'gif' || fileType === 'image') {
                previewItem.classList.add('image-preview');
                const img = document.createElement('img');
                img.src = path;
                previewItem.appendChild(img);
            } else if (fileType === 'video') {
                previewItem.classList.add('video-preview');
                const video = document.createElement('video');
                video.src = path;
                video.controls = true;
                previewItem.appendChild(video);
            } else if (fileType === 'audio') {
                previewItem.classList.add('audio-preview');
                const placeholder = document.createElement('div');
                placeholder.classList.add('audio-placeholder');
                placeholder.textContent = '🎵 Аудио';
                previewItem.appendChild(placeholder);
            }
        } else {
            // Regular File object
            if (type === 'gif' || type === 'image') {
                previewItem.classList.add('image-preview');
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                previewItem.appendChild(img);
            } else if (type === 'video') {
                previewItem.classList.add('video-preview');
                const video = document.createElement('video');
                video.src = URL.createObjectURL(file);
                video.controls = true;
                previewItem.appendChild(video);
            } else if (type === 'audio') {
                previewItem.classList.add('audio-preview');
                const placeholder = document.createElement('div');
                placeholder.classList.add('audio-placeholder');
                placeholder.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
                previewItem.appendChild(placeholder);
            }
        }
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.classList.add('remove-file');
    removeBtn.innerHTML = '×';
    removeBtn.dataset.index = selectedFiles.length - 1;
    removeBtn.addEventListener('click', removeFile);
    
    previewItem.appendChild(removeBtn);
    previewArea.appendChild(previewItem);
    togglePreviewVisibility();
}

function resetPostForm() {
    document.getElementById('post-input').value = '';
    document.getElementById('spoiler-textarea').value = '';
    document.getElementById('spoiler-textarea').style.display = 'none';
    document.getElementById('anonymous-toggle').checked = false;
    document.getElementById('spoiler-toggle').checked = false;
    document.getElementById('nsfw-toggle').checked = false;
    selectedFiles = [];
    fileTypes = [];
    window.pendingPoll = null; // Clear poll
    document.getElementById('files-preview-area').innerHTML = '';
    document.getElementById('files-preview-area').style.display = 'none';
    const postButton = document.getElementById('post-button');
    if (postButton) {
        postButton.disabled = false;
        postButton.textContent = 'Отправить!';
    }
    // Remove poll preview
    const pollPreview = document.querySelector('.poll-preview-item');
    if (pollPreview) pollPreview.remove();
}

function setupPasteSupport() {
    const postInput = document.getElementById('post-input');
    if (!postInput) return;
    
    postInput.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                
                const file = item.getAsFile();
                const fileName = `pasted-image-${Date.now()}.png`;
                const imageFile = new File([file], fileName, { type: file.type });
                
                selectedFiles.push(imageFile);
                fileTypes.push('image');
                
                const previewArea = document.getElementById('files-preview-area');
                if (!previewArea) return;
                
                const previewItem = document.createElement('div');
                previewItem.classList.add('preview-item', 'image-preview');
                
                const img = document.createElement('img');
                img.src = URL.createObjectURL(imageFile);
                previewItem.appendChild(img);
                
                const removeBtn = document.createElement('button');
                removeBtn.classList.add('remove-file');
                removeBtn.innerHTML = '×';
                removeBtn.dataset.index = selectedFiles.length - 1;
                removeBtn.addEventListener('click', removeFile);
                
                previewItem.appendChild(removeBtn);
                previewArea.appendChild(previewItem);
                
                togglePreviewVisibility();
                break;
            }
        }
    });
}

async function loadUserCommunities(userId) {
    try {
        const response = await fetch(`/api/users/${userId}/commIds`);
        if (!response.ok) throw new Error('Failed to fetch user communities');
        
        const communities = await response.json();
        
        const selectElement = document.getElementById('creator-community');
        selectElement.innerHTML = '<option value="">свой профиль</option>';

        communities.forEach(community => {
            const option = document.createElement('option');
            option.value = community.id;
            option.textContent = community.username;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading community selector options:', error);
    }
}
async function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    const previewArea = document.getElementById('files-preview-area');
    if (!previewArea) return;
    
    const newImages = files.filter(f => f.type.startsWith('image/')).length;
    const newVideos = files.filter(f => f.type.startsWith('video/')).length;
    const newAudios = files.filter(f => f.type.startsWith('audio/')).length;
    
    const totalImages = fileTypes.filter(t => t === 'image' || t === 'gif').length + newImages;
    const totalVideos = fileTypes.filter(t => t === 'video').length + newVideos;
    const totalAudios = fileTypes.filter(t => t === 'audio').length + newAudios;
    
    if (totalVideos > 0 && (totalImages > 0 || totalAudios > 0)) {
        alert('Нельзя смешивать видео с изображениями или аудио');
        return;
    }
    
    if (totalVideos > 10) {
        alert('Максимум 10 видео');
        return;
    }
    
    if (totalImages > 10) {
        alert('Максимум 10 изображений');
        return;
    }
    
    if (totalAudios > 3) {
        alert('Максимум 3 аудиофайла');
        return;
    }
    
    for (const file of files) {
        const type = file.type.split('/')[0];
        const isGif = file.type === 'image/gif';
        
        let fileToAdd = file;
        
        if (type === 'image' && !isGif) {
            fileToAdd = await compressImage(file);
        }
        
        selectedFiles.push(fileToAdd);
        fileTypes.push(isGif ? 'gif' : type);
        
        const previewItem = document.createElement('div');
        previewItem.classList.add('preview-item');
        
        if (isGif || type === 'image') {
            previewItem.classList.add('image-preview');
            const img = document.createElement('img');
            img.src = URL.createObjectURL(fileToAdd);
            previewItem.appendChild(img);
        } else if (type === 'video') {
            previewItem.classList.add('video-preview');
            const video = document.createElement('video');
            video.src = URL.createObjectURL(file);
            video.controls = true;
            previewItem.appendChild(video);
        } else if (type === 'audio') {
            previewItem.classList.add('audio-preview');
            const placeholder = document.createElement('div');
            placeholder.classList.add('audio-placeholder');
            placeholder.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
            previewItem.appendChild(placeholder);
        }
        
        const removeBtn = document.createElement('button');
        removeBtn.classList.add('remove-file');
        removeBtn.innerHTML = '×';
        removeBtn.dataset.index = selectedFiles.length - 1;
        removeBtn.addEventListener('click', removeFile);
        
        previewItem.appendChild(removeBtn);
        previewArea.appendChild(previewItem);
    }
    
    togglePreviewVisibility();
    event.target.value = '';
}


let sending = false;

async function createPost() {
    const content = document.getElementById('post-input').value.trim();
    const spoilerPreview = document.getElementById('spoiler-textarea').value.trim();
    const userId = localStorage.getItem('userId');
    if (sending == true) {return};
	sending = true;

    if (!content && selectedFiles.length === 0 && !window.pendingPoll) {
        return;
    }
    
    const postButton = document.getElementById('post-button');
    if (postButton) {
        postButton.disabled = true;
        postButton.textContent = 'Отправка...';
    }
    
    const path = window.location.pathname;
    const isCommunityPage = path.includes('/community');
    const isProfilePage = path.includes('/profile');
    
    let community = '';
    let isAnonymous = false;
    let isSpoiler = false;
    let isNsfw = false;
        isAnonymous = document.getElementById('anonymous-toggle')?.checked || false;
        isSpoiler = document.getElementById('spoiler-toggle')?.checked || false;
        isNsfw = document.getElementById('nsfw-toggle')?.checked || false;
    
    if (isCommunityPage && window.communityPageData) {
        community = window.communityPageData.communityId;
    } else if (isProfilePage) {
        community = '';
    } else {
        const communityDropdown = document.getElementById('creator-community');
        community = communityDropdown ? (communityDropdown.value ? parseInt(communityDropdown.value) : '') : '';
    }
    
    const formData = new FormData();
    formData.append('content', content);
    formData.append('userId', userId);
    formData.append('community', community);
    formData.append('isAnonymous', isAnonymous);
    if (isSpoiler) {
        formData.append('isSpoiler', 1);
        formData.append('spoilerPreview', spoilerPreview);
    }
    if (isNsfw) {
        formData.append('isNsfw', 1);
    }
    
    if (window.pendingPoll) {
        formData.append('poll', JSON.stringify(window.pendingPoll));
    }
    
    // Handle files - separate new uploads from existing library files
    const existingFiles = [];
    const newFiles = [];
    
    selectedFiles.forEach((file, index) => {
        const fileType = fileTypes[index];
        if (typeof file === 'string') {
            existingFiles.push({ path: file, type: fileType });
        } else if (file && file.type === 'existing') {
            existingFiles.push({ path: file.path, type: file.fileType });
        } else {
            newFiles.push(file);
        }
    });
    
    if (existingFiles.length > 0) {
        formData.append('existingFiles', JSON.stringify(existingFiles));
    }
    
    newFiles.forEach(file => {
        formData.append('files', file);
    });
    
    try {
        const response = await fetch('/api/posts', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (data.success) {
            document.getElementById('new-post-overlay').style.display = 'none';
            document.body.style.overflow = '';
            resetPostForm();
            window.pendingPoll = null; // Clear poll
            
            // Refresh feed
            if (isCommunityPage && typeof loadCommunity === 'function') {
                loadCommunity();
            } else if (isProfilePage && typeof loadProfile === 'function') {
                loadProfile();
            } else if (typeof resetAndLoadFeed === 'function') {
                resetAndLoadFeed();
            }
		
	    sending = false;
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось создать пост'));
	    sending = false;
            if (postButton) {
                postButton.disabled = false;
                postButton.textContent = 'Отправить!';
            }
        }
    } catch (err) {
        console.error('Error creating post:', err);
	    sending = false;
        alert('Ошибка сервера');
        if (postButton) {
            postButton.disabled = false;
            postButton.textContent = 'Отправить!';
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('userId')) {
        const path = window.location.pathname;
        const isCommunityPage = path.includes('/community');
        const isProfilePage = path.includes('/profile');
        const isMainPage = path === '/' || path.includes('/main');
        
        if (isMainPage) {
            makePostCreator();
        } else if (isCommunityPage) { 
        } else if (isProfilePage) {
            const urlParams = new URLSearchParams(window.location.search);
            const profileId = urlParams.get('id');
            const currentUserId = localStorage.getItem('userId');
            if (profileId && parseInt(profileId) === parseInt(currentUserId)) {
                makePostCreator();
            }
        }
    }
});

function openPostCreator() {
    const overlay = document.getElementById('new-post-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

// Expose functions for inline onclick
window.toggleSpoilerTextarea = toggleSpoilerTextarea;
window.makePostCreator = makePostCreator;
window.openPostCreator = openPostCreator;