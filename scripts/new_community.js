document.getElementById('register-form').addEventListener('submit', async function(e) {
    e.preventDefault()
    
    const username = document.getElementById('username').value.trim()
    const type = document.getElementById('type').value
    const rules = document.getElementById('rules').value.trim()
    const description = document.getElementById('description').value.trim()
    const profilePic = document.getElementById('profile-pic-input').files[0]
    const isLoggedIn = localStorage.getItem('sessionValid') === 'true'
    
    const errorDiv = document.getElementById('error')
    const successDiv = document.getElementById('success')
    
    // Clear previous messages
    errorDiv.textContent = ''
    successDiv.textContent = ''
    
    if (!username) {
        errorDiv.textContent = 'Введите название порта'
        return
    }
    
    if (!isLoggedIn) {
        errorDiv.textContent = 'Необходимо войти в систему'
        return
    }
    
    const formData = new FormData()
    formData.append('username', username)
    formData.append('type', type)
    formData.append('rules', rules)
    formData.append('description', description)
    if (profilePic) {
        formData.append('profilePicture', profilePic)
    }
    
    try {
        const response = await fetch('/communities/new', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
        })
        
        const data = await response.json()
        
        if (data.success) {
            successDiv.textContent = 'Порт успешно создан! Перенаправляем...'
            setTimeout(() => {
                window.location.href = `/community?id=${data.comm.id}`
            }, 1500)
        } else {
            errorDiv.textContent = data.error || 'Ошибка при создании порта'
        }
    } catch (err) {
        console.error('Error creating community:', err)
        errorDiv.textContent = 'Ошибка сервера'
    }
})