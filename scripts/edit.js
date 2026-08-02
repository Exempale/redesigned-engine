// edit.js
function saveEditedPost(postId, newContent, newImageFile, postDiv, onSuccess) {
  const formData = new FormData()
  formData.append('content', newContent)
  if (newImageFile) {
    formData.append('image', newImageFile)
  }
  
  fetch('/api/posts/' + postId, {
    method: 'PUT',
    body: formData
  })
  .then(response => {
    if (response.ok) {
      // Call the success callback instead of hardcoding loadAndDisplayPosts
      if (onSuccess) {
        onSuccess()
      } else {
        // Fallback: just remove the edit mode and show the post again
        // but better to have a refresh function
        location.reload() // Simple fallback
      }
    } else {
      alert('Failed to update post')
    }
  })
  .catch(err => {
    console.error('Edit error:', err)
    alert('Error updating post')
  })
}

function enterEditMode(post, postDiv, onSaveSuccess) {
  const originalContent = post.content
  const originalImage = post.imagePath
  
  // Store the original HTML to restore if needed
  const originalHTML = postDiv.innerHTML
  
  postDiv.innerHTML = ''

  const editContainer = document.createElement('div')
  editContainer.classList.add('edit-container')
  
  if (originalImage) {
    const imageSection = document.createElement('div')
    imageSection.style.display = 'flex'
    imageSection.style.flexDirection = 'column'
    imageSection.style.gap = '10px'
    imageSection.style.flex = '1'
    
    const currentImg = document.createElement('img')
    currentImg.src = originalImage
    currentImg.classList.add('edit-post-image')
    currentImg.style.width = '100%'
    currentImg.style.maxWidth = '300px'
    imageSection.appendChild(currentImg)
    
    const imageInput = document.createElement('input')
    imageInput.type = 'file'
    imageInput.accept = 'image/*'
    imageInput.classList.add('edit-image-input')
    imageSection.appendChild(imageInput)
    
    editContainer.appendChild(imageSection)
  } else {
    const addImageBtn = document.createElement('button')
    addImageBtn.textContent = '➕ Add Image'
    addImageBtn.classList.add('add-image-btn')
    
    const imageInput = document.createElement('input')
    imageInput.type = 'file'
    imageInput.accept = 'image/*'
    imageInput.style.display = 'none'
    
    addImageBtn.addEventListener('click', () => {
      imageInput.click()
    })
    
    imageInput.addEventListener('change', () => {
      if (imageInput.files[0]) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const oldPreview = editContainer.querySelector('.edit-preview')
          if (oldPreview) oldPreview.remove()
          
          const preview = document.createElement('img')
          preview.src = e.target.result
          preview.classList.add('edit-preview')
          editContainer.insertBefore(preview, addImageBtn)
        }
        reader.readAsDataURL(imageInput.files[0])
      }
    })
    
    editContainer.appendChild(addImageBtn)
    editContainer.appendChild(imageInput)
  }
  
  const textEditor = document.createElement('textarea')
  textEditor.value = originalContent || ''
  textEditor.classList.add('edit-text-editor')
  textEditor.rows = 6
  editContainer.appendChild(textEditor)
  
  const buttonRow = document.createElement('div')
  
  const saveBtn = document.createElement('button')
  saveBtn.textContent = 'Сохранить'
  saveBtn.classList.add('postbutton')
  
  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = 'Отмена'
  cancelBtn.classList.add('postbutton')
  
  saveBtn.addEventListener('click', () => {
    const newContent = textEditor.value
    const newImageFile = editContainer.querySelector('.edit-image-input')?.files[0]
    saveEditedPost(post.id, newContent, newImageFile, postDiv, onSaveSuccess)
  })
  
  cancelBtn.addEventListener('click', () => {
    // Restore original view by reloading the posts
    if (onSaveSuccess) {
      onSaveSuccess() // This should reload the posts
    } else {
      location.reload()
    }
  })
  
  buttonRow.appendChild(saveBtn)
  buttonRow.appendChild(cancelBtn)
  editContainer.appendChild(buttonRow)
  
  postDiv.appendChild(editContainer)
}