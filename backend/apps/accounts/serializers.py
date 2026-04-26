from rest_framework import serializers


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(min_length=3, max_length=50)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=6, max_length=128)
    fullName = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=50)
    password = serializers.CharField(max_length=128)


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)
    username = serializers.CharField(required=False, max_length=50)

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip()
        username = (attrs.get("username") or "").strip()
        if not email and not username:
            raise serializers.ValidationError("Email hoặc tên đăng nhập là bắt buộc.")
        attrs["email"] = email or None
        attrs["username"] = username or None
        return attrs


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    new_password = serializers.CharField(min_length=6, max_length=128)
