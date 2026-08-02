async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options
    })
    const data = await response.json().catch(() => null)

    if (data === null) {
        throw new Error('Сервер вернул некорректный ответ')
    }

    return { response, data }
}

function createButton(id, text, className = '') {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = id
    button.className = className
    button.textContent = text
    return button
}

document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault()
    
    const identifier = document.getElementById('login-identifier').value.trim()
    const password = document.getElementById('password').value
    const errorDiv = document.getElementById('error')
    const successDiv = document.getElementById('success')
    
    errorDiv.textContent = ''
    successDiv.textContent = ''
    
    if (!identifier || !password) {
        errorDiv.textContent = 'Заполните все поля'
        return
    }
    
    try {
        const { response, data } = await fetchJson('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        })

        if (!response.ok || !data.success) {
            if (data.requiresVerification) {
                const resendButton = createButton(
                    'resend-from-login',
                    'Отправить письмо снова'
                )
                resendButton.style.marginTop = '10px'
                resendButton.style.background = '#bef1fc'
                resendButton.style.border = 'none'
                resendButton.style.padding = '5px 10px'
                resendButton.style.borderRadius = '4px'
                resendButton.style.cursor = 'pointer'
                resendButton.addEventListener('click', () => {
                    resendVerification(data.userId)
                })
                errorDiv.replaceChildren(
                    document.createTextNode(data.error || 'Нужно подтвердить email'),
                    document.createElement('br'),
                    resendButton
                )
            } else {
                errorDiv.textContent = data.error || 'Ошибка входа'
            }
            return
        }

        if (!data.user?.id || !data.user?.username) {
            throw new Error('Сервер вернул неполные данные пользователя')
        }

        successDiv.textContent = 'Успешный вход! Перенаправляем...'

        localStorage.setItem('userId', data.user.id)
        localStorage.setItem('username', data.user.username)
        localStorage.setItem('isAdmin', data.user.isAdmin || false)
        localStorage.setItem(
            'userAvatar',
            data.user.profilePicture || '/default-avatar.jpg'
        )

        sessionStorage.setItem('userId', data.user.id)
        sessionStorage.setItem('username', data.user.username)
        sessionStorage.setItem('isAdmin', data.user.isAdmin || false)
        sessionStorage.setItem(
            'userAvatar',
            data.user.profilePicture || '/default-avatar.jpg'
        )

        if (data.needsEmail) {
            showEmailPrompt()
        } else {
            setTimeout(() => { window.location.href = '/' }, 1500)
        }
    } catch (err) {
        console.error('Login error:', err)
        errorDiv.textContent = err.message || 'Ошибка сервера'
    }
});

function showEmailPrompt() {
    const container = document.createElement('div')
    container.className = 'email-prompt'

    const dialog = document.createElement('div')
    dialog.className = 'email-prompt-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'email-prompt-title')

    const title = document.createElement('h3')
    title.id = 'email-prompt-title'
    title.textContent = 'Добавьте email'

    const description = document.createElement('p')
    description.textContent = 'Для безопасности добавьте email к аккаунту'

    const emailInput = document.createElement('input')
    emailInput.type = 'email'
    emailInput.id = 'prompt-email'
    emailInput.placeholder = 'Email'
    emailInput.autocomplete = 'email'

    const actions = document.createElement('div')
    actions.className = 'email-prompt-actions'
    const submitButton = createButton(
        'prompt-submit',
        'Добавить',
        'postbutton'
    )
    const skipButton = createButton(
        'prompt-skip',
        'Пропустить',
        'email-prompt-skip'
    )
    actions.append(submitButton, skipButton)
    dialog.append(title, description, emailInput, actions)
    container.appendChild(dialog)
    document.body.appendChild(container)

    submitButton.addEventListener('click', async () => {
        const email = emailInput.value.trim()
        if (!email || !emailInput.checkValidity()) {
            emailInput.reportValidity()
            return
        }

        submitButton.disabled = true
        try {
            const { response, data } = await fetchJson('/api/add-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            })
            alert(
                data.message || (
                    data.success
                        ? 'Письмо отправлено! Подтвердите email'
                        : data.error || `Ошибка ${response.status}`
                )
            )
            if (response.ok && data.success) container.remove()
        } catch (error) {
            alert(error.message || 'Ошибка сервера')
        } finally {
            submitButton.disabled = false
        }
    })

    skipButton.addEventListener('click', () => {
        container.remove()
        setTimeout(() => { window.location.href = '/' }, 500)
    })

    emailInput.focus()
}

async function resendVerification(userId) {
    const email = prompt('Введите email:');
    if (!email) return;
    
    const res = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email })
    });
    const data = await res.json();
    alert(data.message || (data.success ? 'Письмо отправлено!' : data.error));
}