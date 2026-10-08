<?php
// Minimal stand-ins for the WordPress functions the plugin calls (tests only).
define('ABSPATH', __DIR__);
$GLOBALS['cf_options'] = ['challengeforge_url' => 'https://challenges.example.test', 'challengeforge_secret' => str_repeat('s', 40)];
$GLOBALS['cf_logged_in'] = true;
function __($t, $d = null) { return $t; }
function esc_html__($t, $d = null) { return $t; }
function esc_attr__($t, $d = null) { return $t; }
function esc_html($t) { return htmlspecialchars((string) $t, ENT_QUOTES); }
function esc_attr($t) { return htmlspecialchars((string) $t, ENT_QUOTES); }
function esc_url($t) { return htmlspecialchars((string) $t, ENT_QUOTES); }
function esc_url_raw($t) { return (string) $t; }
function get_option($k, $d = '') { return $GLOBALS['cf_options'][$k] ?? $d; }
function shortcode_atts($defaults, $atts) { return array_merge($defaults, (array) $atts); }
function is_user_logged_in() { return $GLOBALS['cf_logged_in']; }
function admin_url($p) { return 'https://blog.example.test/wp-admin/' . $p; }
function wp_nonce_field($a, $n, $r, $e) { return '<input type="hidden" name="' . $n . '" value="nonce">'; }
function add_shortcode($t, $f) {}
function add_action($h, $f) {}
