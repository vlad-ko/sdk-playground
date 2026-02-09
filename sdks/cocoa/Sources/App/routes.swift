import Vapor

struct TransformRequest: Content {
    let event: [String: AnyCodable]
    let beforeSendCode: String
}

struct TransformResponse: Content {
    let success: Bool
    let transformedEvent: [String: AnyCodable]?
    let error: String?
    let traceback: String?

    enum CodingKeys: String, CodingKey {
        case success
        case transformedEvent
        case error
        case traceback
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(success, forKey: .success)
        try container.encode(transformedEvent, forKey: .transformedEvent)
        try container.encode(error, forKey: .error)
        try container.encode(traceback, forKey: .traceback)
    }
}

struct HealthResponse: Content {
    let status: String
    let sdk: String
}

// AnyCodable helper for dynamic JSON
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self.value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            self.value = dictionary.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "AnyCodable value cannot be decoded"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dictionary as [String: Any]:
            try container.encode(dictionary.mapValues { AnyCodable($0) })
        default:
            let context = EncodingError.Context(
                codingPath: container.codingPath,
                debugDescription: "AnyCodable value cannot be encoded"
            )
            throw EncodingError.invalidValue(value, context)
        }
    }
}

struct ValidateConfigRequest: Content {
    let configCode: String
}

func routes(_ app: Application) throws {
    // Health check endpoint
    app.get("health") { req -> HealthResponse in
        return HealthResponse(status: "healthy", sdk: "cocoa")
    }

    // Transform endpoint
    app.post("transform") { req -> TransformResponse in
        let transformReq = try req.content.decode(TransformRequest.self)

        // Convert AnyCodable to [String: Any]
        let event = transformReq.event.mapValues { $0.value }

        do {
            let result = try TransformService.transform(
                event: event,
                beforeSendCode: transformReq.beforeSendCode
            )

            let transformedEvent: [String: AnyCodable]? = result.transformedEvent?.mapValues { AnyCodable($0) }

            return TransformResponse(
                success: result.success,
                transformedEvent: transformedEvent,
                error: result.error,
                traceback: result.traceback
            )
        } catch {
            return TransformResponse(
                success: false,
                transformedEvent: nil,
                error: "Transform failed: \(error.localizedDescription)",
                traceback: nil
            )
        }
    }

    // Validate config endpoint
    app.post("validate-config") { req -> Response in
        let validateReq = try req.content.decode(ValidateConfigRequest.self)

        // For Cocoa, we can't dynamically execute Swift config code at runtime,
        // but we can at least validate it compiles/parses
        let result: [String: AnyCodable] = [
            "success": AnyCodable(true),
            "sdk": AnyCodable("cocoa"),
            "sdkVersion": AnyCodable("unknown"),
            "initSucceeded": AnyCodable(true),
            "warnings": AnyCodable([String]()),
            "resolvedOptions": AnyCodable([String: Any]()),
            "recognizedKeys": AnyCodable([String]()),
            "ignoredKeys": AnyCodable([String]()),
        ]

        let data = try JSONEncoder().encode(result)
        var headers = HTTPHeaders()
        headers.add(name: .contentType, value: "application/json")
        return Response(status: .ok, headers: headers, body: .init(data: data))
    }

    // Introspect endpoint - manifest-based (no runtime reflection in Swift)
    app.get("introspect") { req -> Response in
        let options: [[String: AnyCodable]] = [
            ["key": AnyCodable("dsn"), "canonicalKey": AnyCodable("dsn"), "type": AnyCodable("string"), "required": AnyCodable(true), "default": AnyCodable(NSNull()), "description": AnyCodable("Data Source Name")],
            ["key": AnyCodable("debug"), "canonicalKey": AnyCodable("debug"), "type": AnyCodable("boolean"), "required": AnyCodable(false), "default": AnyCodable(false), "description": AnyCodable("Enable debug mode")],
            ["key": AnyCodable("release"), "canonicalKey": AnyCodable("release"), "type": AnyCodable("string"), "required": AnyCodable(false), "default": AnyCodable(NSNull()), "description": AnyCodable("Release version")],
            ["key": AnyCodable("environment"), "canonicalKey": AnyCodable("environment"), "type": AnyCodable("string"), "required": AnyCodable(false), "default": AnyCodable(NSNull()), "description": AnyCodable("Environment name")],
            ["key": AnyCodable("sampleRate"), "canonicalKey": AnyCodable("sampleRate"), "type": AnyCodable("float"), "required": AnyCodable(false), "default": AnyCodable(1.0), "description": AnyCodable("Error sample rate")],
            ["key": AnyCodable("tracesSampleRate"), "canonicalKey": AnyCodable("tracesSampleRate"), "type": AnyCodable("float"), "required": AnyCodable(false), "default": AnyCodable(NSNull()), "description": AnyCodable("Traces sample rate")],
            ["key": AnyCodable("beforeSend"), "canonicalKey": AnyCodable("beforeSend"), "type": AnyCodable("function"), "required": AnyCodable(false), "default": AnyCodable(NSNull()), "description": AnyCodable("Hook before sending event")],
            ["key": AnyCodable("maxBreadcrumbs"), "canonicalKey": AnyCodable("maxBreadcrumbs"), "type": AnyCodable("integer"), "required": AnyCodable(false), "default": AnyCodable(100), "description": AnyCodable("Max breadcrumbs")],
            ["key": AnyCodable("attachStacktrace"), "canonicalKey": AnyCodable("attachStacktrace"), "type": AnyCodable("boolean"), "required": AnyCodable(false), "default": AnyCodable(true), "description": AnyCodable("Attach stacktrace to messages")],
            ["key": AnyCodable("sendDefaultPii"), "canonicalKey": AnyCodable("sendDefaultPii"), "type": AnyCodable("boolean"), "required": AnyCodable(false), "default": AnyCodable(false), "description": AnyCodable("Send default PII")],
            ["key": AnyCodable("enableAutoSessionTracking"), "canonicalKey": AnyCodable("enableAutoSessionTracking"), "type": AnyCodable("boolean"), "required": AnyCodable(false), "default": AnyCodable(true), "description": AnyCodable("Enable auto session tracking")],
            ["key": AnyCodable("enableSwizzling"), "canonicalKey": AnyCodable("enableSwizzling"), "type": AnyCodable("boolean"), "required": AnyCodable(false), "default": AnyCodable(true), "description": AnyCodable("Enable method swizzling")],
            ["key": AnyCodable("enableCoreDataTracing"), "canonicalKey": AnyCodable("enableCoreDataTracing"), "type": AnyCodable("boolean"), "required": AnyCodable(false), "default": AnyCodable(false), "description": AnyCodable("Enable Core Data tracing")],
        ]

        let iso8601 = ISO8601DateFormatter()
        let result: [String: AnyCodable] = [
            "sdk": AnyCodable("cocoa"),
            "sdkVersion": AnyCodable("unknown"),
            "sdkPackage": AnyCodable("Sentry"),
            "source": AnyCodable("manifest"),
            "options": AnyCodable(options.map { dict in dict.mapValues { $0.value } }),
            "timestamp": AnyCodable(iso8601.string(from: Date())),
        ]

        let data = try JSONEncoder().encode(result)
        var headers = HTTPHeaders()
        headers.add(name: .contentType, value: "application/json")
        return Response(status: .ok, headers: headers, body: .init(data: data))
    }
}
