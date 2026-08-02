// modspace.js - Moderation panel logic

(function() {
    'use strict';

    // ===== LOADING SCREEN =====
    function initLoadingScreen() {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        
        function hideLoading() {
            overlay.classList.add('hidden');
            setTimeout(function() {
                overlay.style.display = 'none';
            }, 500);
        }
        
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(hideLoading, 300);
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(hideLoading, 300);
            });
        }
        
        window.addEventListener('load', function() {
            setTimeout(hideLoading, 300);
        });
        
        setTimeout(hideLoading, 5000);
    }

    // ===== CHECK ADMIN =====
    async function checkAdmin() {
        try {
            const response = await fetch('/api/isAdmin', {
                credentials: 'same-origin'
            });
            const data = await response.json();
            if (!data.canModerate) {
                document.getElementById('mod-content').innerHTML = `
                    <div class="mod-empty">
                        <h2>Доступ запрещён</h2>
                        <p>У вас нет прав модератора для доступа к этой странице.</p>
                        <button onclick="window.location.href='/'" style="margin-top:16px; padding:10px 24px; border-radius:8px; border:2px solid #8FDADB; background:white; cursor:pointer;">Вернуться на главную</button>
                    </div>
                `;
                return false;
            }
            return data;
        } catch (err) {
            console.error('Admin check error:', err);
            return false;
        }
    }

    // ===== LOAD FLAGS =====
    async function loadFlags() {
        const container = document.getElementById('mod-content');
        container.innerHTML = '<div class="mod-loading"><div class="spinner"></div><p>Загрузка жалоб...</p></div>';

        try {
            const response = await fetch('/api/mod/flagged-posts', {
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error('Failed to load flags');
            }

            const data = await response.json();
            const flags = data.flags || [];

            document.getElementById('pending-count').textContent = flags.length;

            if (flags.length === 0) {
                container.innerHTML = `
                    <div class="mod-empty">
                        <h2>Чисто</h2>
                        <p>Нет жалоб, ожидающих модерации.</p>
                    </div>
                `;
                return;
            }

            let html = '';
            for (const flag of flags) {
                const flagTypeClass = `flag-type-${flag.flagType}`;
                const violationCount = flag.violationCount || 0;
                const userNotes = flag.notes || '';
                
                html += `
                    <div class="flag-card" data-flag-id="${flag.id}">
                        <div class="flag-card-header">
                            <div class="flag-card-left">
                                <div class="flag-card-post">
                                    <a href="/post?id=${flag.postId}" target="_blank">
                                        ${escapeHtml(flag.postContent || '[Пост без текста]')}
                                    </a>
                                </div>
                                <div class="flag-card-meta">
                                    <span class="flag-type ${flagTypeClass}">${formatFlagType(flag.flagType)}</span>
                                    <span>Пост #${flag.postId}</span>
                                    <span>${formatTime(flag.submittedAt)}</span>
                                </div>
                                ${userNotes ? `
                                    <div class="flag-notes">
                                        <span class="label">📝 Примечания от пользователя:</span>
                                        ${escapeHtml(userNotes)}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="flag-card-right">
                                <div class="flag-card-submitter">
                                    Жалоба от <a href="/profile?id=${flag.submittedBy}" target="_blank">${escapeHtml(flag.submitterName || 'Неизвестно')}</a>
                                </div>
                                <div class="violation-count-badge">
                                    Нарушений: <span class="count">${violationCount}</span>
                                </div>
                            </div>
                        </div>
                        <div class="flag-card-actions">
                            <button class="action-btn secondary" onclick="viewPost(${flag.postId})">Открыть пост</button>
                            <button class="action-btn secondary" onclick="viewProfile(${flag.postAuthorId})">Автор</button>
                            <button class="action-btn secondary" onclick="viewProfile(${flag.submittedBy})">Заявитель</button>
                            <button class="action-btn" onclick="moderateFlag(${flag.id}, 'hide', this)">Скрыть пост</button>
                            <button class="action-btn secondary" onclick="moderateFlag(${flag.id}, 'unhide', this)">Показать пост</button>
                            <button class="action-btn secondary" onclick="moderateFlag(${flag.id}, 'dismiss', this)">Отклонить жалобу</button>
                            <button class="action-btn" onclick="moderateFlag(${flag.id}, 'resolve', this)">Закрыть жалобу</button>
                            <button class="action-btn danger" onclick="deleteReportedPost(${flag.postId}, ${flag.id}, this)">Удалить пост</button>
                        </div>
                    </div>
                `;
            }

            container.innerHTML = html;

        } catch (err) {
            console.error('Load flags error:', err);
            container.innerHTML = `
                <div class="mod-empty">
                    <h2>Ошибка</h2>
                    <p>Не удалось загрузить жалобы. Попробуйте обновить страницу.</p>
                    <button onclick="loadFlags()" style="margin-top:16px; padding:10px 24px; border-radius:8px; border:2px solid #8FDADB; background:white; cursor:pointer;">Обновить</button>
                </div>
            `;
        }
    }

    async function moderateFlag(flagId, action, button) {
        const card = button.closest('.flag-card');
        button.disabled = true;
        try {
            const response = await fetch(`/api/mod/reports/${flagId}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось применить действие');
            if (action === 'dismiss' || action === 'resolve') {
                card.remove();
                updatePendingCount();
            } else {
                button.textContent = action === 'hide' ? 'Пост скрыт' : 'Пост виден';
            }
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    }

    async function deleteReportedPost(postId, flagId, button) {
        if (!confirm('Удалить этот пост без возможности восстановления?')) return;
        button.disabled = true;
        try {
            const response = await fetch(`/api/posts/${postId}`, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось удалить пост');
            await moderateFlag(flagId, 'resolve', button);
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    }

    function updatePendingCount() {
        const remaining = document.querySelectorAll('.flag-card').length;
        document.getElementById('pending-count').textContent = remaining;
        if (!remaining) {
            document.getElementById('mod-content').innerHTML = '<div class="mod-empty"><h2>Чисто</h2><p>Все жалобы обработаны.</p></div>';
        }
    }

    function viewProfile(userId) {
        if (userId) window.open(`/profile?id=${encodeURIComponent(userId)}`, '_blank');
    }

    // ===== LEGACY RESOLVE COMPATIBILITY =====
    async function resolveFlag(flagId, button) {
    const card = button.closest('.flag-card');
    const select = card.querySelector('.violation-select');
    const violation = select.value;

    button.disabled = true;
    button.textContent = 'Обработка...';

    try {
        const response = await fetch('/api/mod/flag/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flagId, violation }),  // REMOVED notes
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
            card.style.transition = 'all 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.95)';
            setTimeout(() => {
                card.remove();
                const remaining = document.querySelectorAll('.flag-card').length;
                document.getElementById('pending-count').textContent = remaining;
                if (remaining === 0) {
                    document.getElementById('mod-content').innerHTML = `
                        <div class="mod-empty">
                            <h2>Чисто</h2>
                            <p>Все жалобы обработаны. Отличная работа!</p>
                        </div>
                    `;
                }
            }, 300);
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось обработать жалобу'));
            button.disabled = false;
            button.textContent = 'Применить';
        }
    } catch (err) {
        console.error('Resolve error:', err);
        alert('Ошибка сервера');
        button.disabled = false;
        button.textContent = 'Применить';
    }
}

    // ===== VIEW POST =====
    function viewPost(postId) {
        window.open(`/post?id=${postId}`, '_blank');
    }

    async function loadAnnouncementHistory() {
        const container = document.getElementById('announcement-history');
        if (!container) return;
        container.innerHTML = '<div class="mod-loading">Загрузка истории...</div>';
        try {
            const response = await fetch('/api/announcements/history', { credentials: 'same-origin' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Не удалось загрузить историю');
            const announcements = data.announcements || [];
            container.innerHTML = announcements.length ? announcements.map(item => `
                <article class="announcement-history-card ${item.isActive ? '' : 'inactive'}">
                    <div>
                        <div class="announcement-history-text">${escapeHtml(item.text)}</div>
                        <div class="announcement-history-meta">
                            ${escapeHtml(item.senderUsername)} · ${new Date(item.createdAt).toLocaleString('ru-RU')} · закрыли: ${item.dismissalCount}
                        </div>
                    </div>
                    <button type="button" class="action-btn secondary" onclick="toggleAnnouncement(${item.id}, ${!item.isActive}, this)">
                        ${item.isActive ? 'Деактивировать' : 'Активировать'}
                    </button>
                </article>
            `).join('') : '<div class="mod-empty"><p>История уведомлений пуста.</p></div>';
        } catch (error) {
            container.innerHTML = `<div class="mod-empty"><p>${escapeHtml(error.message)}</p></div>`;
        }
    }

    async function toggleAnnouncement(announcementId, isActive, button) {
        button.disabled = true;
        try {
            const response = await fetch(`/api/announcements/${announcementId}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось обновить уведомление');
            loadAnnouncementHistory();
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    }

    function initAnnouncementAdmin(capabilities) {
        if (!capabilities.isDeveloper) return;
        const section = document.getElementById('announcement-admin');
        const form = document.getElementById('announcement-form');
        const status = document.getElementById('announcement-form-status');
        section.hidden = false;
        document.getElementById('announcement-refresh').addEventListener('click', loadAnnouncementHistory);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const textInput = document.getElementById('announcement-text');
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            status.textContent = 'Публикация...';
            try {
                const response = await fetch('/api/announcements', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: textInput.value })
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось опубликовать');
                textInput.value = '';
                status.textContent = 'Опубликовано';
                loadAnnouncementHistory();
            } catch (error) {
                status.textContent = error.message;
            } finally {
                submitButton.disabled = false;
            }
        });
        loadAnnouncementHistory();
    }

    // ===== HELPER FUNCTIONS =====
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatFlagType(type) {
    const map = {
        'spam': 'Спам',
        'nsfw': 'NSFW',
        'unmarked_nsfw': 'NSFW без метки', // Keep for backward compatibility
        'harassment': 'Травля',
        'hatespeech': 'Язык вражды',
        'illegal': 'Незаконный контент',
        'copyright': 'Нарушение авторских прав',
        'other': 'Другое'
    };
    return map[type] || type;
}

    function formatTime(timestamp) {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        
        if (diff < 60) return 'Только что';
        if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
        if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
        if (diff < 604800) return Math.floor(diff / 86400) + ' дн назад';
        
        return date.toLocaleDateString('ru-RU');
    }

    // ===== INIT =====
    function init() {
        initLoadingScreen();
        
        document.addEventListener('DOMContentLoaded', async function() {
            const capabilities = await checkAdmin();
            if (capabilities) {
                loadFlags();
                initAnnouncementAdmin(capabilities);
                setInterval(loadFlags, 30000);
            }
        });
    }

    // Expose functions to global scope
    window.loadFlags = loadFlags;
    window.resolveFlag = resolveFlag;
    window.moderateFlag = moderateFlag;
    window.deleteReportedPost = deleteReportedPost;
    window.toggleAnnouncement = toggleAnnouncement;
    window.viewProfile = viewProfile;
    window.viewPost = viewPost;

    // Start
    init();

})();