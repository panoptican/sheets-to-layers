## TICKET-010: Image Fill Sync from URLs

**Type:** Feature  
**Priority:** High  

### Description

Implement image downloading and fill application for vector layers when the sheet value is an image URL. Support both direct image URLs and Google Drive share links.

### Requirements

- Detect when a value is an image URL (http:// or https://)
- Download image from URL
- Convert to Figma image hash
- Apply as fill to vector layers
- Support Google Drive share links with automatic URL conversion
- Handle image loading errors gracefully
- Only apply to vector-type layers (not text, frames, or components)

### Technical Specifications

**URL Detection & Conversion:**

```typescript
function isImageUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isGoogleDriveUrl(url: string): boolean {
  return url.includes('drive.google.com');
}

function convertGoogleDriveUrl(url: string): string {
  // Convert Google Drive share URL to direct download URL
  // Share URL: https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing
  // Direct URL: https://drive.google.com/uc?export=download&id={FILE_ID}
  
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    const fileId = fileIdMatch[1];
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  return url;
}
```

**Image Fetching & Application:**

```typescript
async function syncImageFill(node: SceneNode, imageUrl: string): Promise<void> {
  // Validate node type - images only work on certain layer types
  if (!canHaveImageFill(node)) {
    console.warn(`Cannot apply image fill to ${node.type} layer: ${node.name}`);
    return;
  }
  
  try {
    // Convert Google Drive URLs
    const downloadUrl = isGoogleDriveUrl(imageUrl) 
      ? convertGoogleDriveUrl(imageUrl) 
      : imageUrl;
    
    // Fetch image in UI context and send to main thread
    // This requires message passing since network access is in UI
    const imageData = await fetchImageFromUI(downloadUrl);
    
    // Create Figma image from bytes
    const image = figma.createImage(imageData);
    
    // Apply as fill
    const fills: Paint[] = [{
      type: 'IMAGE',
      scaleMode: 'FILL',
      imageHash: image.hash
    }];
    
    (node as GeometryMixin).fills = fills;
    
  } catch (error) {
    console.error(`Failed to load image from ${imageUrl}:`, error);
    figma.notify(`Failed to load image: ${node.name}`, { error: true });
  }
}

function canHaveImageFill(node: SceneNode): boolean {
  // Image fills work on shapes/vectors, not text, frames, or instances
  const validTypes: NodeType[] = [
    'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 
    'VECTOR', 'LINE', 'BOOLEAN_OPERATION'
  ];
  return validTypes.includes(node.type);
}
```

**UI to Main Thread Image Transfer:**

```typescript
// In UI context:
async function fetchImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Message passing:
// UI -> Main: { type: 'IMAGE_DATA', url: string, data: Uint8Array }
```

### Dependencies

TICKET-007, TICKET-008

### Acceptance Criteria

- [ ] Detects image URLs correctly (http/https)
- [ ] Downloads images from direct URLs
- [ ] Converts and downloads from Google Drive share links
- [ ] Applies image as fill with FILL scale mode
- [ ] Only applies to valid layer types
- [ ] Shows warning for invalid layer types
- [ ] Handles network errors gracefully with user notification
- [ ] Large images load without timeout (reasonable size limits)