<?php
// Fallback router for static SPA in Flock / PHP servers
$file = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (is_file($file)) {
    $mime = mime_content_type($file);
    if (str_ends_with($file, '.wasm')) $mime = 'application/wasm';
    elseif (str_ends_with($file, '.js')) $mime = 'application/javascript';
    elseif (str_ends_with($file, '.css')) $mime = 'text/css';
    elseif (str_ends_with($file, '.json')) $mime = 'application/json';
    elseif (str_ends_with($file, '.webp')) $mime = 'image/webp';
    header("Content-Type: $mime");
    readfile($file);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
