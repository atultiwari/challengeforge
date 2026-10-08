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
    $next = '/play/' . $id;
    $secret = (string) get_option('challengeforge_secret', '');
    if (!is_user_logged_in() || strlen($secret) < 32) {
        return sprintf('<a class="challengeforge-link" href="%s" target="_blank" rel="noopener">%s</a>', esc_url($base . $next), esc_html($atts['label']));
    }
    $user = wp_get_current_user();
    $token = challengeforge_build_token($secret, rtrim(home_url(), '/'), $base, (string) $user->ID, (string) $user->display_name, $next);
    // A POST (not a link): the token never lands in a URL, browser history or a referrer.
    return sprintf(
        '<form class="challengeforge-sso" method="post" action="%s" target="_blank"><input type="hidden" name="token" value="%s"><button type="submit">%s</button></form>',
        esc_url($base . '/sso/wordpress'),
        esc_attr($token),
        esc_html($atts['label'])
    );
}
add_shortcode('challengeforge', 'challengeforge_shortcode');

/** Settings → ChallengeForge */
function challengeforge_settings_init(): void
{
    register_setting('challengeforge', 'challengeforge_url', ['type' => 'string', 'sanitize_callback' => 'esc_url_raw']);
    register_setting('challengeforge', 'challengeforge_secret', ['type' => 'string', 'sanitize_callback' => 'sanitize_text_field']);
}
add_action('admin_init', 'challengeforge_settings_init');

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
                    <td><input type="password" id="challengeforge_secret" name="challengeforge_secret" class="regular-text" value="<?php echo esc_attr(get_option('challengeforge_secret', '')); ?>" autocomplete="off"></td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <p><?php echo esc_html__('Then add [challengeforge challenge="<challenge id>"] to any page or post.', 'challengeforge'); ?></p>
    </div>
    <?php
}
