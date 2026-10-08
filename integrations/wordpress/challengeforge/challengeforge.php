<?php
/**
 * Plugin Name: ChallengeForge
 * Description: Link to ChallengeForge challenges with a shortcode, and (optionally) sign your WordPress members straight in.
 * Version: 1.0.0
 * Requires PHP: 7.4
 * License: MIT
 *
 * Shortcode: [challengeforge challenge="<challenge id>" label="Start the challenge"]
 * Signed-in WordPress users arrive at ChallengeForge already signed in (as their own
 * linked account there); visitors who are not signed in just get a normal link.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/includes/token.php';

const CHALLENGEFORGE_ID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

function challengeforge_url(): string
{
    return rtrim((string) get_option('challengeforge_url', ''), '/');
}

/** [challengeforge challenge="..." label="..."] */
function challengeforge_shortcode($atts): string
{
    $atts = shortcode_atts(['challenge' => '', 'label' => __('Start the challenge', 'challengeforge')], $atts, 'challengeforge');
    $id = strtolower(trim((string) $atts['challenge']));
    $base = challengeforge_url();
    if ($base === '' || !preg_match(CHALLENGEFORGE_ID_PATTERN, $id)) {
        return '';
    }
    if (!is_user_logged_in() || strlen((string) get_option('challengeforge_secret', '')) < 32) {
        return sprintf('<a class="challengeforge-link" href="%s" target="_blank" rel="noopener">%s</a>', esc_url($base . '/play/' . $id), esc_html($atts['label']));
    }
    // The page holds NO token (pages are often cached): the button asks WordPress for one at click time.
    return sprintf(
        '<form class="challengeforge-sso" method="post" action="%s" target="_blank"><input type="hidden" name="action" value="challengeforge_sso"><input type="hidden" name="challenge" value="%s">%s<button type="submit">%s</button></form>',
        esc_url(admin_url('admin-post.php')),
        esc_attr($id),
        wp_nonce_field('challengeforge_sso', '_cfnonce', true, false),
        esc_html($atts['label'])
    );
}

/** Mints the short-lived token for the signed-in member and posts it on to ChallengeForge. */
function challengeforge_sso(): void
{
    nocache_headers();
    $id = strtolower(trim((string) ($_POST['challenge'] ?? '')));
    $base = challengeforge_url();
    $secret = (string) get_option('challengeforge_secret', '');
    if (!is_user_logged_in() || !check_admin_referer('challengeforge_sso', '_cfnonce') || $base === '' || strlen($secret) < 32 || !preg_match(CHALLENGEFORGE_ID_PATTERN, $id)) {
        wp_die(esc_html__('This link could not be opened. Go back and try again.', 'challengeforge'), '', ['response' => 400]);
    }
    $user = wp_get_current_user();
    $token = challengeforge_build_token($secret, rtrim(home_url(), '/'), $base, (string) $user->ID, (string) $user->display_name, '/play/' . $id);
    // A POST (not a link): the token never lands in a URL, browser history or a referrer.
    printf(
        '<!doctype html><meta charset="utf-8"><title>%1$s</title><form id="cf" method="post" action="%2$s"><input type="hidden" name="token" value="%3$s"><noscript><button type="submit">%1$s</button></noscript></form><script>document.getElementById("cf").submit()</script>',
        esc_html__('Opening ChallengeForge…', 'challengeforge'),
        esc_url($base . '/sso/wordpress'),
        esc_attr($token)
    );
    exit;
}
add_action('admin_post_challengeforge_sso', 'challengeforge_sso');
add_shortcode('challengeforge', 'challengeforge_shortcode');

/** Settings → ChallengeForge */
function challengeforge_settings_init(): void
{
    register_setting('challengeforge', 'challengeforge_url', ['type' => 'string', 'sanitize_callback' => 'challengeforge_sanitize_url']);
    register_setting('challengeforge', 'challengeforge_secret', ['type' => 'string', 'sanitize_callback' => 'challengeforge_sanitize_secret']);
}
add_action('admin_init', 'challengeforge_settings_init');

/** https only (a local test site may use http://localhost): sign-on tokens must not cross the network in clear text. */
function challengeforge_sanitize_url($value): string
{
    $url = esc_url_raw(trim((string) $value));
    $host = (string) wp_parse_url($url, PHP_URL_HOST);
    $scheme = (string) wp_parse_url($url, PHP_URL_SCHEME);
    if ($scheme === 'https' || ($scheme === 'http' && in_array($host, ['localhost', '127.0.0.1'], true))) {
        return rtrim($url, '/');
    }
    add_settings_error('challengeforge_url', 'challengeforge_url', __('Use the https:// address of your ChallengeForge site.', 'challengeforge'));
    return (string) get_option('challengeforge_url', '');
}

/** An empty field keeps the stored secret, so the secret never has to be shown again. */
function challengeforge_sanitize_secret($value): string
{
    $value = trim((string) $value);
    return $value === '' ? (string) get_option('challengeforge_secret', '') : sanitize_text_field($value);
}

function challengeforge_settings_menu(): void
{
    add_options_page('ChallengeForge', 'ChallengeForge', 'manage_options', 'challengeforge', 'challengeforge_settings_page');
}
add_action('admin_menu', 'challengeforge_settings_menu');

function challengeforge_settings_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }
    ?>
    <div class="wrap">
        <h1>ChallengeForge</h1>
        <p><?php echo esc_html__('In ChallengeForge, open Admin → WordPress, enter this site\'s address, and copy the secret it shows into the field below.', 'challengeforge'); ?></p>
        <form method="post" action="options.php">
            <?php settings_fields('challengeforge'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="challengeforge_url">ChallengeForge address</label></th>
                    <td><input type="url" id="challengeforge_url" name="challengeforge_url" class="regular-text" value="<?php echo esc_attr(get_option('challengeforge_url', '')); ?>" placeholder="https://challenges.example.org"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="challengeforge_secret">Shared secret</label></th>
                    <td><input type="password" id="challengeforge_secret" name="challengeforge_secret" class="regular-text" value="" autocomplete="off" placeholder="<?php echo get_option('challengeforge_secret', '') !== '' ? esc_attr__('Saved: leave empty to keep it', 'challengeforge') : ''; ?>"></td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <p><?php echo esc_html__('Then add [challengeforge challenge="<challenge id>"] to any page or post.', 'challengeforge'); ?></p>
    </div>
    <?php
}
