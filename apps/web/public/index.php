<?php
declare(strict_types=1);

// Fallback router for static SPA in Flock / PHP servers with path traversal and header hardening
header('Cross-Origin-Opener-Policy: same-origin');
header('Cross-Origin-Embedder-Policy: credentialless');
header('Cross-Origin-Resource-Policy: same-origin');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: DENY');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(self)');
header(
    "Content-Security-Policy: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; worker-src 'self'; "
    . "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    . "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://hok.kurohiko.id https://game.gtimg.cn https://camp.honorofkings.com; "
    . "connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
);

$root = realpath(__DIR__);
$rawPath = (string) (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$decodedPath = rawurldecode($rawPath);

if (str_contains($decodedPath, "\0")) {
    http_response_code(400);
    exit;
}

$relative = ltrim(str_replace('\\', '/', $decodedPath), '/');

if ($root !== false && $relative !== '' && $relative !== 'index.php') {
    $segments = array_filter(explode('/', $relative), static fn (string $part): bool => $part !== '' && $part !== '.');
    foreach ($segments as $segment) {
        if ($segment === '..' || str_starts_with($segment, '.')) {
            http_response_code(403);
            exit;
        }
    }

    $candidate = $root . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $segments);
    $resolved = realpath($candidate);

    if ($resolved !== false && str_starts_with($resolved, $root . DIRECTORY_SEPARATOR) && is_file($resolved)) {
        $ext = strtolower(pathinfo($resolved, PATHINFO_EXTENSION));
        if ($ext === 'php') {
            http_response_code(403);
            exit;
        }

        $mimeMap = [
            'html'  => 'text/html; charset=utf-8',
            'js'    => 'application/javascript; charset=utf-8',
            'mjs'   => 'application/javascript; charset=utf-8',
            'css'   => 'text/css; charset=utf-8',
            'json'  => 'application/json; charset=utf-8',
            'svg'   => 'image/svg+xml',
            'webp'  => 'image/webp',
            'png'   => 'image/png',
            'jpg'   => 'image/jpeg',
            'jpeg'  => 'image/jpeg',
            'woff2' => 'font/woff2',
            'wasm'  => 'application/wasm',
            'txt'   => 'text/plain; charset=utf-8',
        ];

        $mime = $mimeMap[$ext] ?? 'application/octet-stream';
        header("Content-Type: $mime");
        if (str_contains($resolved, DIRECTORY_SEPARATOR . 'chunks' . DIRECTORY_SEPARATOR)) {
            header('Cache-Control: public, max-age=31536000, immutable');
        } elseif (basename($resolved) === 'data_manifest.json') {
            header('Cache-Control: no-cache');
        }
        readfile($resolved);
        exit;
    }
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
readfile(__DIR__ . '/index.html');
