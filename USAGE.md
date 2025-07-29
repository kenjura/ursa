# Test Library Usage

This is a test to verify that the library can be imported and used correctly.

## Testing both import styles:

```javascript
// Default import
import generateSite from '@kenjura/ursa';

// Named import  
import { generate } from '@kenjura/ursa';
```

## Usage Examples:

### Default function:
```javascript
await generateSite({
  source: './content',
  meta: './meta', 
  output: './dist'
});
```

### Direct generate function:
```javascript
await generate({
  _source: './content',
  _meta: './meta',
  _output: './dist'  
});
```

## CLI Usage:

```bash
# Install globally or use npx
npm install -g @kenjura/ursa

# Generate site
ursa ./content --meta=./meta --output=./dist

# With defaults (meta=meta, output=output)
ursa ./content
```
