// Auth Helper Functions
const AuthHelper = {
    API_URL: 'http://localhost:3000/api',

    // Lấy token từ localStorage
    getToken() {
        return localStorage.getItem('token');
    },

    // Lấy user từ localStorage
    getUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    },

    // Kiểm tra đã đăng nhập chưa
    isLoggedIn() {
        return !!this.getToken();
    },

    // Lưu auth info
    setAuth(token, user) {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
    },

    // Xóa auth info
    clearAuth() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    },

    // Logout
    async logout() {
        const token = this.getToken();
        if (token) {
            try {
                await fetch(`${this.API_URL}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
        }
        this.clearAuth();
        window.location.href = 'login.html';
    },

    // Verify token
    async verifyToken() {
        const token = this.getToken();
        if (!token) return false;

        try {
            const response = await fetch(`${this.API_URL}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                // Cập nhật user info
                localStorage.setItem('user', JSON.stringify(data.user));
                return true;
            } else {
                this.clearAuth();
                return false;
            }
        } catch (error) {
            console.error('Token verification error:', error);
            return false;
        }
    },

    // Log activity
    async logActivity(activityType, page, details = {}) {
        const token = this.getToken();
        if (!token) return;

        try {
            await fetch(`${this.API_URL}/activity/log`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    activityType,
                    page,
                    details
                })
            });
        } catch (error) {
            console.error('Log activity error:', error);
        }
    },

    // Thêm auth header cho fetch request
    getAuthHeaders() {
        const token = this.getToken();
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    },

    // Fetch với auto auth
    async authenticatedFetch(url, options = {}) {
        const token = this.getToken();
        
        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        });

        // Nếu unauthorized, redirect to login
        if (response.status === 401) {
            this.clearAuth();
            window.location.href = 'login.html';
        }

        return response;
    },

    // Render user info in navbar
    renderUserInfo(containerId = 'userInfo') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const user = this.getUser();
        if (!user) {
            container.innerHTML = `
                <a href="login.html" style="color: #00d9ff; text-decoration: none; padding: 8px 16px; border-radius: 8px; background: rgba(0,217,255,0.1);">
                    🔐 Đăng nhập
                </a>
            `;
        } else {
            container.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="color: rgba(255,255,255,0.8);">
                        👤 ${user.fullName || user.username}
                    </span>
                    <button onclick="AuthHelper.logout()" style="padding: 8px 16px; border: none; border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; transition: all 0.3s;">
                        Đăng xuất
                    </button>
                </div>
            `;
        }
    }
};

// Auto check auth on page load
window.addEventListener('load', async () => {
    // Các trang không cần auth
    const publicPages = ['login.html', 'register.html'];
    const currentPage = window.location.pathname.split('/').pop();
    
    if (!publicPages.includes(currentPage)) {
        // Verify token
        const isValid = await AuthHelper.verifyToken();
        
        // Optional: Có thể bỏ qua bước này nếu muốn cho phép truy cập không cần đăng nhập
        // if (!isValid) {
        //     window.location.href = 'login.html';
        // }
        
        // Render user info
        AuthHelper.renderUserInfo();
    }
});