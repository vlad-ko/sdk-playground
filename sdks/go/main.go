package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type TransformRequest struct {
	Event          map[string]interface{} `json:"event" binding:"required"`
	BeforeSendCode string                 `json:"beforeSendCode" binding:"required"`
}

type TransformResponse struct {
	Success          bool        `json:"success"`
	TransformedEvent interface{} `json:"transformedEvent,omitempty"`
	Error            string      `json:"error,omitempty"`
	Traceback        string      `json:"traceback,omitempty"`
}

type HealthResponse struct {
	Status string `json:"status"`
	SDK    string `json:"sdk"`
}

type ValidationRequest struct {
	Code string `json:"code" binding:"required"`
}

type ValidationError struct {
	Line    *int   `json:"line,omitempty"`
	Column  *int   `json:"column,omitempty"`
	Message string `json:"message"`
}

type ValidationResponse struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors"`
}

func setupRouter() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	router.POST("/transform", transformHandler)
	router.POST("/validate", validateHandler)
	router.POST("/validate-config", validateConfigHandler)
	router.GET("/introspect", introspectHandler)
	router.GET("/health", healthHandler)

	return router
}

func transformHandler(c *gin.Context) {
	var req TransformRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, TransformResponse{
			Success: false,
			Error:   "Missing event or beforeSendCode",
		})
		return
	}

	// Create temporary directory for the transform execution
	tmpDir, err := ioutil.TempDir("", "beforesend-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, TransformResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to create temp directory: %v", err),
		})
		return
	}
	defer os.RemoveAll(tmpDir)

	// Create the transform program
	programPath := filepath.Join(tmpDir, "transform.go")
	eventJSON, _ := json.Marshal(req.Event)

	// Use strconv.Quote to properly escape the JSON for Go source code
	// This handles backticks, quotes, newlines, and all special characters
	quotedEventJSON := strconv.Quote(string(eventJSON))

	program := fmt.Sprintf(`package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Suppress unused import warning
var _ = strings.Contains

type Event map[string]interface{}
type EventHint map[string]interface{}

func main() {
	eventJSON := %s

	var event Event
	if err := json.Unmarshal([]byte(eventJSON), &event); err != nil {
		panic(err)
	}

	// User's beforeSend/tracesSampler code
	// Returns interface{} to support both Event (map) and float64 (sample rate)
	result := func(event Event, hint EventHint) interface{} {
		%s
	}(event, EventHint{})

	if result == nil {
		fmt.Println("null")
		return
	}

	// Handle different return types
	switch v := result.(type) {
	case float64:
		// tracesSampler returns a float
		fmt.Printf("%%v\n", v)
	case int:
		// Integer (convert to float for consistency)
		fmt.Printf("%%v\n", float64(v))
	case Event, map[string]interface{}:
		// beforeSend returns an event
		output, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		fmt.Println(string(output))
	default:
		// Try to marshal as JSON (catches other map types)
		output, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		fmt.Println(string(output))
	}
}
`, quotedEventJSON, req.BeforeSendCode)

	// Write the program to file
	if err := ioutil.WriteFile(programPath, []byte(program), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, TransformResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to write program: %v", err),
		})
		return
	}

	// Initialize go module in temp directory
	// Include sentry-go in case users want to use sentry types
	goModContent := `module transform
go 1.22
`
	goModPath := filepath.Join(tmpDir, "go.mod")
	if err := ioutil.WriteFile(goModPath, []byte(goModContent), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, TransformResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to write go.mod: %v", err),
		})
		return
	}

	// Run go mod tidy to create go.sum
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = tmpDir
	var tidyErr bytes.Buffer
	tidyCmd.Stderr = &tidyErr
	if err := tidyCmd.Run(); err != nil {
		c.JSON(http.StatusBadRequest, TransformResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to resolve dependencies: %s", tidyErr.String()),
		})
		return
	}

	// Try to compile first to catch syntax errors
	compileCmd := exec.Command("go", "build", "-mod=readonly", "-o", "/dev/null", "transform.go")
	compileCmd.Dir = tmpDir
	var compileErr bytes.Buffer
	compileCmd.Stderr = &compileErr

	if err := compileCmd.Run(); err != nil {
		errorMsg := compileErr.String()
		c.JSON(http.StatusBadRequest, TransformResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to compile beforeSend code: %s", errorMsg),
		})
		return
	}

	// Execute the program
	runCmd := exec.Command("go", "run", "transform.go")
	runCmd.Dir = tmpDir
	var stdout, stderr bytes.Buffer
	runCmd.Stdout = &stdout
	runCmd.Stderr = &stderr

	if err := runCmd.Run(); err != nil {
		errorMsg := stderr.String()
		if errorMsg == "" {
			errorMsg = err.Error()
		}
		c.JSON(http.StatusInternalServerError, TransformResponse{
			Success:   false,
			Error:     "Transformation error: " + errorMsg,
			Traceback: errorMsg,
		})
		return
	}

	// Parse the result
	output := strings.TrimSpace(stdout.String())

	if output == "null" {
		c.JSON(http.StatusOK, TransformResponse{
			Success:          true,
			TransformedEvent: nil,
		})
		return
	}

	// Try to parse as a number first (for tracesSampler)
	if num, err := strconv.ParseFloat(output, 64); err == nil {
		c.JSON(http.StatusOK, TransformResponse{
			Success:          true,
			TransformedEvent: num,
		})
		return
	}

	// Otherwise parse as JSON object (for beforeSend)
	var transformedEvent map[string]interface{}
	if err := json.Unmarshal([]byte(output), &transformedEvent); err != nil {
		c.JSON(http.StatusInternalServerError, TransformResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to parse result: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, TransformResponse{
		Success:          true,
		TransformedEvent: transformedEvent,
	})
}

func validateHandler(c *gin.Context) {
	var req ValidationRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ValidationResponse{
			Valid: false,
			Errors: []ValidationError{
				{Message: "Missing code parameter"},
			},
		})
		return
	}

	// Create temporary directory for validation
	tmpDir, err := ioutil.TempDir("", "validate-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, ValidationResponse{
			Valid: false,
			Errors: []ValidationError{
				{Message: fmt.Sprintf("Validation service error: %v", err)},
			},
		})
		return
	}
	defer os.RemoveAll(tmpDir)

	// Create a simple validation program
	programPath := filepath.Join(tmpDir, "validate.go")
	program := fmt.Sprintf(`package main

type Event map[string]interface{}
type EventHint map[string]interface{}

func main() {
	_ = func(event Event, hint EventHint) Event {
		%s
	}
}
`, req.Code)

	// Write the program to file
	if err := ioutil.WriteFile(programPath, []byte(program), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, ValidationResponse{
			Valid: false,
			Errors: []ValidationError{
				{Message: fmt.Sprintf("Validation service error: %v", err)},
			},
		})
		return
	}

	// Initialize go module
	goModContent := `module validate
go 1.22
`
	goModPath := filepath.Join(tmpDir, "go.mod")
	if err := ioutil.WriteFile(goModPath, []byte(goModContent), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, ValidationResponse{
			Valid: false,
			Errors: []ValidationError{
				{Message: fmt.Sprintf("Validation service error: %v", err)},
			},
		})
		return
	}

	// Try to compile - this checks syntax
	compileCmd := exec.Command("go", "build", "-o", "/dev/null", "validate.go")
	compileCmd.Dir = tmpDir
	var compileErr bytes.Buffer
	compileCmd.Stderr = &compileErr

	if err := compileCmd.Run(); err != nil {
		errorMsg := compileErr.String()

		// Try to extract line number from error message
		// Go errors look like: "./validate.go:5:2: syntax error: ..."
		var line *int
		parts := strings.Split(errorMsg, ":")
		if len(parts) >= 2 {
			if lineNum, err := strconv.Atoi(parts[1]); err == nil {
				// Subtract the header lines we added
				actualLine := lineNum - 4
				if actualLine > 0 {
					line = &actualLine
				}
			}
		}

		c.JSON(http.StatusOK, ValidationResponse{
			Valid: false,
			Errors: []ValidationError{
				{
					Line:    line,
					Message: errorMsg,
				},
			},
		})
		return
	}

	c.JSON(http.StatusOK, ValidationResponse{
		Valid:  true,
		Errors: []ValidationError{},
	})
}

// ValidateConfig types
type ValidateConfigRequest struct {
	ConfigCode string `json:"configCode" binding:"required"`
}

type ConfigValidationResponse struct {
	Success         bool                   `json:"success"`
	SDK             string                 `json:"sdk"`
	SDKVersion      string                 `json:"sdkVersion"`
	InitSucceeded   bool                   `json:"initSucceeded"`
	Error           string                 `json:"error,omitempty"`
	Warnings        []string               `json:"warnings"`
	ResolvedOptions map[string]interface{} `json:"resolvedOptions"`
	RecognizedKeys  []string               `json:"recognizedKeys"`
	IgnoredKeys     []string               `json:"ignoredKeys"`
}

type IntrospectedOption struct {
	Key          string      `json:"key"`
	CanonicalKey string      `json:"canonicalKey"`
	Type         string      `json:"type"`
	Required     bool        `json:"required"`
	Default      interface{} `json:"default"`
	Description  string      `json:"description"`
}

type IntrospectionResponse struct {
	SDK        string               `json:"sdk"`
	SDKVersion string               `json:"sdkVersion"`
	SDKPackage string               `json:"sdkPackage"`
	Source     string               `json:"source"`
	Options    []IntrospectedOption `json:"options"`
	Timestamp  string               `json:"timestamp"`
}

func validateConfigHandler(c *gin.Context) {
	var req ValidateConfigRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ConfigValidationResponse{
			Success:         false,
			SDK:             "go",
			InitSucceeded:   false,
			Error:           "Missing configCode",
			Warnings:        []string{},
			ResolvedOptions: map[string]interface{}{},
			RecognizedKeys:  []string{},
			IgnoredKeys:     []string{},
		})
		return
	}

	// Create a temp Go program that calls sentry.Init() with a noop transport
	tmpDir, err := ioutil.TempDir("", "validate-config-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, ConfigValidationResponse{
			Success: false,
			SDK:     "go",
			Error:   fmt.Sprintf("Failed to create temp directory: %v", err),
		})
		return
	}
	defer os.RemoveAll(tmpDir)

	program := fmt.Sprintf(`package main

import (
	"encoding/json"
	"fmt"
	"github.com/getsentry/sentry-go"
	"reflect"
)

func main() {
	// User's config code - should call sentry.Init(...)
	// We intercept by wrapping
	origInit := sentry.Init

	var resolvedOptions map[string]interface{}
	var initErr error

	// Monkey-patch not possible in Go, so we compile the config directly
	err := func() error {
		%s
		return nil
	}()

	if err != nil {
		initErr = err
	}

	// Try to get the current client options via reflection
	hub := sentry.CurrentHub()
	client := hub.Client()
	resolvedOptions = make(map[string]interface{})
	recognizedKeys := []string{}

	if client != nil {
		opts := client.Options()
		v := reflect.ValueOf(opts)
		t := v.Type()
		for i := 0; i < v.NumField(); i++ {
			field := t.Field(i)
			if !field.IsExported() {
				continue
			}
			val := v.Field(i)
			key := field.Name
			recognizedKeys = append(recognizedKeys, key)
			switch val.Kind() {
			case reflect.String:
				resolvedOptions[key] = val.String()
			case reflect.Bool:
				resolvedOptions[key] = val.Bool()
			case reflect.Float64, reflect.Float32:
				resolvedOptions[key] = val.Float()
			case reflect.Int, reflect.Int64:
				resolvedOptions[key] = val.Int()
			default:
				resolvedOptions[key] = fmt.Sprintf("%%v", val.Interface())
			}
		}
	}

	_ = origInit
	result := map[string]interface{}{
		"success":         true,
		"sdk":             "go",
		"sdkVersion":      sentry.SDKVersion,
		"initSucceeded":   initErr == nil,
		"warnings":        []string{},
		"resolvedOptions": resolvedOptions,
		"recognizedKeys":  recognizedKeys,
		"ignoredKeys":     []string{},
	}
	if initErr != nil {
		result["error"] = initErr.Error()
	}

	output, _ := json.Marshal(result)
	fmt.Println(string(output))
}
`, req.ConfigCode)

	programPath := filepath.Join(tmpDir, "main.go")
	if err := ioutil.WriteFile(programPath, []byte(program), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, ConfigValidationResponse{
			Success: false,
			SDK:     "go",
			Error:   fmt.Sprintf("Failed to write program: %v", err),
		})
		return
	}

	goModContent := `module validate-config
go 1.22
require github.com/getsentry/sentry-go v0.31.1
`
	goModPath := filepath.Join(tmpDir, "go.mod")
	if err := ioutil.WriteFile(goModPath, []byte(goModContent), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, ConfigValidationResponse{
			Success: false,
			SDK:     "go",
			Error:   fmt.Sprintf("Failed to write go.mod: %v", err),
		})
		return
	}

	// Run go mod tidy
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = tmpDir
	var tidyErr bytes.Buffer
	tidyCmd.Stderr = &tidyErr
	if err := tidyCmd.Run(); err != nil {
		c.JSON(http.StatusBadRequest, ConfigValidationResponse{
			Success:    false,
			SDK:        "go",
			Error:      fmt.Sprintf("Failed to resolve dependencies: %s", tidyErr.String()),
			Warnings:   []string{},
			ResolvedOptions: map[string]interface{}{},
			RecognizedKeys:  []string{},
			IgnoredKeys:     []string{},
		})
		return
	}

	// Compile
	compileCmd := exec.Command("go", "build", "-mod=readonly", "-o", "/dev/null", "main.go")
	compileCmd.Dir = tmpDir
	var compileErr bytes.Buffer
	compileCmd.Stderr = &compileErr
	if err := compileCmd.Run(); err != nil {
		c.JSON(http.StatusOK, ConfigValidationResponse{
			Success:        true,
			SDK:            "go",
			SDKVersion:     "",
			InitSucceeded:  false,
			Error:          fmt.Sprintf("Compilation error: %s", compileErr.String()),
			Warnings:       []string{},
			ResolvedOptions: map[string]interface{}{},
			RecognizedKeys: []string{},
			IgnoredKeys:    []string{},
		})
		return
	}

	// Execute
	runCmd := exec.Command("go", "run", "main.go")
	runCmd.Dir = tmpDir
	var stdout, stderr bytes.Buffer
	runCmd.Stdout = &stdout
	runCmd.Stderr = &stderr

	if err := runCmd.Run(); err != nil {
		c.JSON(http.StatusOK, ConfigValidationResponse{
			Success:        true,
			SDK:            "go",
			InitSucceeded:  false,
			Error:          stderr.String(),
			Warnings:       []string{},
			ResolvedOptions: map[string]interface{}{},
			RecognizedKeys: []string{},
			IgnoredKeys:    []string{},
		})
		return
	}

	// Parse JSON output
	var result ConfigValidationResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout.String())), &result); err != nil {
		c.JSON(http.StatusInternalServerError, ConfigValidationResponse{
			Success: false,
			SDK:     "go",
			Error:   fmt.Sprintf("Failed to parse result: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

func introspectHandler(c *gin.Context) {
	// Go uses struct reflection on sentry.ClientOptions
	// We generate and run a Go program that reflects on the struct
	tmpDir, err := ioutil.TempDir("", "introspect-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   fmt.Sprintf("Failed to create temp directory: %v", err),
		})
		return
	}
	defer os.RemoveAll(tmpDir)

	program := `package main

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"
	"unicode"

	"github.com/getsentry/sentry-go"
)

type Option struct {
	Key          string      ` + "`json:\"key\"`" + `
	CanonicalKey string      ` + "`json:\"canonicalKey\"`" + `
	Type         string      ` + "`json:\"type\"`" + `
	Required     bool        ` + "`json:\"required\"`" + `
	Default      interface{} ` + "`json:\"default\"`" + `
	Description  string      ` + "`json:\"description\"`" + `
}

func pascalToCamel(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	runes[0] = unicode.ToLower(runes[0])
	return string(runes)
}

func goTypeToString(t reflect.Type) string {
	switch t.Kind() {
	case reflect.String:
		return "string"
	case reflect.Bool:
		return "boolean"
	case reflect.Float64, reflect.Float32:
		return "float"
	case reflect.Int, reflect.Int64, reflect.Int32:
		return "integer"
	case reflect.Slice:
		return "array"
	case reflect.Map:
		return "object"
	case reflect.Func:
		return "function"
	case reflect.Interface:
		return "any"
	default:
		return t.String()
	}
}

func main() {
	t := reflect.TypeOf(sentry.ClientOptions{})
	options := make([]Option, 0)

	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		options = append(options, Option{
			Key:          field.Name,
			CanonicalKey: pascalToCamel(field.Name),
			Type:         goTypeToString(field.Type),
			Required:     field.Name == "Dsn",
			Default:      nil,
			Description:  "",
		})
	}

	_ = strings.Contains // suppress unused

	result := map[string]interface{}{
		"sdk":        "go",
		"sdkVersion": sentry.SDKVersion,
		"sdkPackage": "github.com/getsentry/sentry-go",
		"source":     "reflection",
		"options":    options,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	}

	output, _ := json.Marshal(result)
	fmt.Println(string(output))
}
`

	programPath := filepath.Join(tmpDir, "main.go")
	if err := ioutil.WriteFile(programPath, []byte(program), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   fmt.Sprintf("Failed to write program: %v", err),
		})
		return
	}

	goModContent := `module introspect
go 1.22
require github.com/getsentry/sentry-go v0.31.1
`
	goModPath := filepath.Join(tmpDir, "go.mod")
	if err := ioutil.WriteFile(goModPath, []byte(goModContent), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   fmt.Sprintf("Failed to write go.mod: %v", err),
		})
		return
	}

	// Tidy, compile, run
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = tmpDir
	tidyCmd.Run()

	runCmd := exec.Command("go", "run", "main.go")
	runCmd.Dir = tmpDir
	var stdout, stderr bytes.Buffer
	runCmd.Stdout = &stdout
	runCmd.Stderr = &stderr

	if err := runCmd.Run(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   fmt.Sprintf("Introspection failed: %s", stderr.String()),
		})
		return
	}

	var result IntrospectionResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout.String())), &result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   fmt.Sprintf("Failed to parse result: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Status: "healthy",
		SDK:    "go",
	})
}

func main() {
	router := setupRouter()
	router.Run(":5006")
}
