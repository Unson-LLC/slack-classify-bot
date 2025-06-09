# n8n Webhook Configuration Guide

## Issue
The n8n workflow is encountering a GitHub 404 error when trying to create files. The error suggests the file path or repository configuration might be incorrect.

## Solution

### 1. Fix the GitHub Node Configuration

In your "Commit to GitHub" node, change the operation from "Create" to "Create or Update" if available, or handle the case where files might already exist.

### 2. Configure the Webhook Response

At the end of your n8n workflow, add a "Respond to Webhook" node with the following configuration:

#### For Success Response:
```json
{
  "status": "success",
  "github": {
    "owner": "{{ $('Commit to GitHub').item.json.owner }}",
    "repo": "{{ $('Commit to GitHub').item.json.repo }}",
    "file_path": "{{ $('Commit to GitHub').item.json.path }}",
    "commit": {
      "sha": "{{ $('Commit to GitHub').item.json.sha }}",
      "message": "{{ $('Commit to GitHub').item.json.message }}",
      "url": "{{ $('Commit to GitHub').item.json.html_url }}"
    }
  }
}
```

#### For Error Response:
```json
{
  "status": "error",
  "error": {
    "message": "{{ $('Commit to GitHub').item.json.message }}",
    "details": "{{ $('Commit to GitHub').item.json.documentation_url }}"
  }
}
```

### 3. Handle File Path Issues

The error shows the workflow is trying to create a file at:
```
meetings/2025-06-09-test.md
```

Make sure:
1. The `meetings` directory exists in your repository
2. The file path doesn't contain invalid characters
3. The branch specified exists (default: main)

### 4. Update the Workflow Logic

Add an IF node before the GitHub commit to check if the file already exists, then:
- If file exists: Use "Update" operation
- If file doesn't exist: Use "Create" operation

### 5. Test the Webhook Response

You can test your webhook response by adding a test response like:
```json
{
  "status": "success",
  "github": {
    "owner": "UnsonJack",
    "repo": "solesistailor",
    "file_path": "meetings/2025-06-09-test.md",
    "commit": {
      "sha": "abc123def456",
      "message": "Add meeting transcript",
      "url": "https://github.com/UnsonJack/solesistailor/commit/abc123def456"
    }
  }
}
```

## Lambda Code Updates

The Lambda code has been updated to handle:
1. GitHub commit information display
2. Error messages from n8n
3. Both old and new response formats

Deploy the updated Lambda function to see the changes.