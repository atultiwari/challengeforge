<?php
/**
 * Builds the short-lived sign-on token ChallengeForge accepts (HS256 JWT).
 * Pure PHP with no WordPress calls, so it can be tested on its own.
 */

if (!function_exists('challengeforge_base64url')) {
    function challengeforge_base64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}

if (!function_exists('challengeforge_build_token')) {
    /**
     * @param string $secret   The secret shown once by ChallengeForge (Admin → WordPress).
     * @param string $issuer   This WordPress site's address, exactly as connected (no trailing slash).
     * @param string $audience The ChallengeForge site address (no trailing slash).
     * @param string $user_id  The WordPress user id (digits).
     * @param string $name     The user's display name.
     * @param string $next     The ChallengeForge path to open, e.g. /play/<challenge id>.
     * @param int    $now      Unix time (for tests).
     */
    function challengeforge_build_token(string $secret, string $issuer, string $audience, string $user_id, string $name, string $next, ?int $now = null): string
    {
        $now = $now ?? time();
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $payload = [
            'iss' => $issuer,
            'aud' => $audience,
            'sub' => $user_id,
            'name' => $name,
            'iat' => $now,
            'exp' => $now + 120,
            'jti' => bin2hex(random_bytes(16)),
            'next' => $next,
        ];
        $signing_input = challengeforge_base64url(json_encode($header, JSON_UNESCAPED_SLASHES)) . '.' . challengeforge_base64url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $signature = hash_hmac('sha256', $signing_input, $secret, true);
        return $signing_input . '.' . challengeforge_base64url($signature);
    }
}
