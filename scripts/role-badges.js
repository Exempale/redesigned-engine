(function () {
    const ROLE_META = Object.freeze({
        owner: {
            label: 'Создатель FortPort',
            icon: '/ui/icons/owner-badge.webp'
        },
        developer: {
            label: 'Разработчик FortPort',
            icon: '/ui/icons/developer-badge.webp'
        },
        moderator: {
            label: 'Модератор FortPort',
            icon: '/ui/icons/moderator-badge.webp'
        }
    });

    function resolveRole(user = {}) {
        if (user.displayRole && ROLE_META[user.displayRole]) return user.displayRole;
        if (user.isOwner || Number(user.id ?? user.userId) === 1773499483205) return 'owner';
        if (user.isDeveloper) return 'developer';
        if (user.isModerator) return 'moderator';
        return null;
    }

    function applyName(element, user = {}) {
        const role = resolveRole(user);
        if (!element) return role;
        element.classList.remove('role-name', 'role-name-owner', 'role-name-developer', 'role-name-moderator');
        if (role) element.classList.add('role-name', `role-name-${role}`);
        return role;
    }

    function createBadge(user = {}, options = {}) {
        const role = resolveRole(user);
        if (!role) return null;
        const meta = ROLE_META[role];
        const badge = document.createElement('span');
        badge.className = `role-badge role-badge-${role}${options.compact ? ' role-badge-compact' : ''}${options.profile ? ' role-badge-profile' : ''}`;
        badge.setAttribute('aria-label', meta.label);
        badge.setAttribute('data-tooltip', meta.label);
        badge.tabIndex = 0;
        badge.setAttribute('role', 'img');

        const image = document.createElement('img');
        image.src = meta.icon;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        badge.appendChild(image);
        return badge;
    }

    function badgeHtml(user = {}, options = {}) {
        const role = resolveRole(user);
        if (!role) return '';
        const meta = ROLE_META[role];
        const classes = `role-badge role-badge-${role}${options.compact ? ' role-badge-compact' : ''}${options.profile ? ' role-badge-profile' : ''}`;
        return `<span class="${classes}" tabindex="0" role="img" aria-label="${meta.label}" data-tooltip="${meta.label}"><img src="${meta.icon}" alt="" aria-hidden="true"></span>`;
    }

    const inlineParentSelector = [
        '.role-identity-line',
        '.profile-right-name',
        '.comment-author-identity',
        '.friend-card-name-row',
        '.chat-card-name-row',
        '.notification-actor',
        '.lightbox-footer-username-row',
        '.utility-profile',
        '.chat-partner-name-line'
    ].join(', ');

    const roleNameSelector = [
        '.role-name',
        '.author-name',
        '.author-name-user',
        '.friend-card-name',
        '.chat-card-name',
        '.notification-actor-name',
        '.utility-username',
        '.chat-partner-name',
        '.lightbox-footer-username'
    ].join(', ');

    function lockBadgeBesideName(badge) {
        if (!(badge instanceof Element) || !badge.classList.contains('role-badge')) return;
        const parent = badge.parentElement;
        if (!parent) return;

        if (parent.matches(inlineParentSelector)) {
            parent.classList.add('role-identity-line');
            return;
        }

        const name = badge.previousElementSibling;
        if (!name?.matches(roleNameSelector)) return;

        const identityLine = document.createElement('span');
        identityLine.className = 'role-identity-line';
        parent.insertBefore(identityLine, name);
        identityLine.append(name, badge);
    }

    function normalizeRoleBadges(root = document) {
        if (root instanceof Element && root.classList.contains('role-badge')) {
            lockBadgeBesideName(root);
        }
        root.querySelectorAll?.('.role-badge').forEach(lockBadgeBesideName);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => normalizeRoleBadges(), { once: true });
    } else {
        normalizeRoleBadges();
    }

    new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node instanceof Element) normalizeRoleBadges(node);
            });
        });
    }).observe(document.documentElement, { childList: true, subtree: true });

    window.FortPortRoles = Object.freeze({ resolveRole, applyName, createBadge, badgeHtml, meta: ROLE_META });
})();