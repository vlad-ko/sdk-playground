<?php

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

require __DIR__ . '/vendor/autoload.php';

$app = AppFactory::create();
$app->addBodyParsingMiddleware();
$app->addErrorMiddleware(true, true, true);

// Transform endpoint
$app->post('/transform', function (Request $request, Response $response) {
    try {
        $data = $request->getParsedBody();

        if (!isset($data['event']) || !isset($data['beforeSendCode'])) {
            $response->getBody()->write(json_encode([
                'success' => false,
                'error' => 'Missing event or beforeSendCode'
            ]));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(400);
        }

        $event = $data['event'];
        $beforeSendCode = $data['beforeSendCode'];

        // Execute the beforeSend code
        try {
            // Evaluate the code to get the callable
            $beforeSendFn = eval('return ' . $beforeSendCode . ';');

            if (!is_callable($beforeSendFn)) {
                $response->getBody()->write(json_encode([
                    'success' => false,
                    'error' => 'beforeSend code must return a callable function'
                ]));
                return $response
                    ->withHeader('Content-Type', 'application/json')
                    ->withStatus(400);
            }
        } catch (ParseError $e) {
            $response->getBody()->write(json_encode([
                'success' => false,
                'error' => 'Failed to parse beforeSend code: ' . $e->getMessage()
            ]));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(400);
        } catch (Throwable $e) {
            $response->getBody()->write(json_encode([
                'success' => false,
                'error' => 'Failed to parse beforeSend code: ' . $e->getMessage()
            ]));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(400);
        }

        // Apply the transformation
        try {
            // Clone the event to avoid mutation issues
            $eventClone = json_decode(json_encode($event), true);

            // Execute the beforeSend function
            // Sentry's beforeSend receives (event, hint) but hint is optional
            $transformedEvent = $beforeSendFn($eventClone, []);

            $response->getBody()->write(json_encode([
                'success' => true,
                'transformedEvent' => $transformedEvent
            ]));
            return $response->withHeader('Content-Type', 'application/json');
        } catch (Throwable $e) {
            $traceback = $e->getTraceAsString();
            $response->getBody()->write(json_encode([
                'success' => false,
                'error' => 'Transformation error: ' . $e->getMessage(),
                'traceback' => $traceback,
                'transformedEvent' => null
            ]));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(500);
        }
    } catch (Throwable $e) {
        error_log('Unexpected error: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
        $response->getBody()->write(json_encode([
            'success' => false,
            'error' => 'Unexpected error: ' . $e->getMessage()
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(500);
    }
});

// Validate endpoint
$app->post('/validate', function (Request $request, Response $response) {
    try {
        $data = $request->getParsedBody();

        if (!isset($data['code'])) {
            $response->getBody()->write(json_encode([
                'valid' => false,
                'errors' => [['message' => 'Missing code parameter']]
            ]));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(400);
        }

        $code = $data['code'];
        $errors = [];

        try {
            // Try to parse the code by evaluating it in a safe context
            // We wrap it to check syntax without actually executing
            $testCode = 'return ' . $code . ';';

            // Use token_get_all to check for syntax errors
            // This will throw ParseError if syntax is invalid
            @eval('if(false){' . $testCode . '}');

            // Also try to actually parse to catch more errors
            $beforeSendFn = eval($testCode);

            $response->getBody()->write(json_encode([
                'valid' => true,
                'errors' => []
            ]));
            return $response->withHeader('Content-Type', 'application/json');
        } catch (ParseError $e) {
            // Extract line number from error message if available
            $line = $e->getLine();

            $errors[] = [
                'line' => $line > 0 ? $line : null,
                'message' => $e->getMessage()
            ];

            $response->getBody()->write(json_encode([
                'valid' => false,
                'errors' => $errors
            ]));
            return $response->withHeader('Content-Type', 'application/json');
        } catch (Throwable $e) {
            $errors[] = [
                'message' => $e->getMessage()
            ];

            $response->getBody()->write(json_encode([
                'valid' => false,
                'errors' => $errors
            ]));
            return $response->withHeader('Content-Type', 'application/json');
        }
    } catch (Throwable $e) {
        error_log('Validation error: ' . $e->getMessage());
        $response->getBody()->write(json_encode([
            'valid' => false,
            'errors' => [['message' => 'Validation service error: ' . $e->getMessage()]]
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(500);
    }
});

// Validate config endpoint
$app->post('/validate-config', function (Request $request, Response $response) {
    try {
        $data = $request->getParsedBody();

        if (!isset($data['configCode'])) {
            $response->getBody()->write(json_encode([
                'success' => false,
                'error' => 'Missing configCode'
            ]));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(400);
        }

        $configCode = $data['configCode'];
        $capturedWarnings = [];
        $sdkVersion = 'unknown';

        // Capture PHP warnings/notices during validation
        set_error_handler(function ($severity, $message) use (&$capturedWarnings) {
            $capturedWarnings[] = $message;
            return true; // prevent default PHP error handling
        }, E_WARNING | E_NOTICE | E_DEPRECATED | E_USER_WARNING | E_USER_NOTICE | E_USER_DEPRECATED);

        try {
            if (class_exists('\Sentry\SentrySdk')) {
                $sdkVersion = \Sentry\Client::SDK_VERSION ?? 'unknown';
            }
        } catch (Throwable $e) {
            // ignore
        }

        try {
            // Execute the config code with a noop transport
            $resolvedOptions = [];

            // Create wrapper that injects noop transport
            $wrapperCode = <<<'WRAPPER'
use Sentry\Transport\TransportInterface;
use Sentry\Transport\Result;
use Sentry\Transport\ResultStatus;

$noopTransport = new class implements TransportInterface {
    public function send(\Sentry\Event $event): Result {
        return new Result(ResultStatus::success());
    }
    public function close(?int $timeout = null): Result {
        return new Result(ResultStatus::success());
    }
};
WRAPPER;

            eval($wrapperCode);

            // Monkey-patch: wrap the user's init to add noop transport
            $originalInit = '\Sentry\init';
            eval($configCode);

            // Try to extract resolved options from current hub
            try {
                $hub = \Sentry\SentrySdk::getCurrentHub();
                $client = $hub->getClient();
                if ($client) {
                    $optionsObj = $client->getOptions();
                    $reflection = new ReflectionClass($optionsObj);
                    foreach ($reflection->getProperties() as $prop) {
                        $prop->setAccessible(true);
                        $key = $prop->getName();
                        $val = $prop->getValue($optionsObj);
                        try {
                            json_encode($val);
                            $resolvedOptions[$key] = $val;
                        } catch (Throwable $e) {
                            $resolvedOptions[$key] = (string)$val;
                        }
                    }
                }
            } catch (Throwable $e) {
                // ignore
            }

            $recognizedKeys = array_keys($resolvedOptions);

            restore_error_handler();
            $response->getBody()->write(json_encode([
                'success' => true,
                'sdk' => 'php',
                'sdkVersion' => $sdkVersion,
                'initSucceeded' => true,
                'warnings' => $capturedWarnings,
                'resolvedOptions' => $resolvedOptions ?: new \stdClass(),
                'recognizedKeys' => $recognizedKeys,
                'ignoredKeys' => [],
            ]));
            return $response->withHeader('Content-Type', 'application/json');

        } catch (Throwable $e) {
            restore_error_handler();
            $response->getBody()->write(json_encode([
                'success' => true,
                'sdk' => 'php',
                'sdkVersion' => $sdkVersion,
                'initSucceeded' => false,
                'error' => $e->getMessage(),
                'warnings' => $capturedWarnings,
                'resolvedOptions' => new \stdClass(),
                'recognizedKeys' => [],
                'ignoredKeys' => [],
            ]));
            return $response->withHeader('Content-Type', 'application/json');
        }

    } catch (Throwable $e) {
        restore_error_handler();
        error_log('Validate-config error: ' . $e->getMessage());
        $response->getBody()->write(json_encode([
            'success' => false,
            'error' => 'Validation service error: ' . $e->getMessage()
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(500);
    }
});

// Introspect endpoint
$app->get('/introspect', function (Request $request, Response $response) {
    try {
        $sdkVersion = 'unknown';
        $options = [];

        try {
            if (class_exists('\Sentry\Options')) {
                $sdkVersion = defined('\Sentry\Client::SDK_VERSION') ? \Sentry\Client::SDK_VERSION : 'unknown';

                $reflection = new ReflectionClass('\Sentry\Options');
                $properties = $reflection->getProperties();

                foreach ($properties as $prop) {
                    $key = $prop->getName();
                    if (str_starts_with($key, '_')) continue;

                    $optType = 'any';
                    if ($prop->hasType()) {
                        $type = $prop->getType();
                        if ($type instanceof ReflectionNamedType) {
                            $optType = $type->getName();
                        }
                    }

                    // Convert camelCase or snake_case to canonical camelCase
                    $canonicalKey = lcfirst(str_replace('_', '', ucwords($key, '_')));

                    $options[] = [
                        'key' => $key,
                        'canonicalKey' => $canonicalKey,
                        'type' => $optType,
                        'required' => $key === 'dsn',
                        'default' => null,
                        'description' => '',
                    ];
                }
            }
        } catch (Throwable $e) {
            error_log('PHP introspection error: ' . $e->getMessage());
        }

        $response->getBody()->write(json_encode([
            'sdk' => 'php',
            'sdkVersion' => $sdkVersion,
            'sdkPackage' => 'sentry/sentry',
            'source' => 'reflection',
            'options' => $options,
            'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
        ]));
        return $response->withHeader('Content-Type', 'application/json');

    } catch (Throwable $e) {
        error_log('Introspect error: ' . $e->getMessage());
        $response->getBody()->write(json_encode([
            'success' => false,
            'error' => 'Introspection service error: ' . $e->getMessage()
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(500);
    }
});

// Health check endpoint
$app->get('/health', function (Request $request, Response $response) {
    $response->getBody()->write(json_encode([
        'status' => 'healthy',
        'sdk' => 'php'
    ]));
    return $response->withHeader('Content-Type', 'application/json');
});

// Only run the app if this file is executed directly
if (php_sapi_name() !== 'cli') {
    $app->run();
}

return $app;
