from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    message = "You do not have permission to access this resource."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and getattr(user, "is_authenticated", False) and getattr(user, "role", "") == "admin")
