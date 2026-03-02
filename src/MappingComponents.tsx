// Define interfaces for our component props
interface SearchResultItemProps {
  result: {
    name: string;
    link?: string;
    [key: string]: any;
  };
  // Fixed: Updated onLinkClick to accept optional string
  onLinkClick: (link: string | undefined, resultName: string) => void;
}

interface SearchResultsListProps {
  searchResults: Array<{
    name: string;
    link?: string;
    [key: string]: any;
  }>;
  // Fixed: Updated onLinkClick to accept optional string
  onLinkClick: (link: string | undefined, resultName: string) => void;
}

interface NameListItemProps {
  name: string;
  index: number;
  draggable: boolean;
  onDragStart: (e: React.DragEvent, item: string) => void;
  onRemove: (name: string) => void;
  isSelected: boolean;
}

interface NamesListProps {
  names: string[];
  draggable?: boolean;
  onDragStart: (e: React.DragEvent, item: string) => void;
  onRemove: (name: string) => void;
  isSelected?: boolean;
  height?: string;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  emptyMessage: string;
  loading?: boolean;
}

interface ImageTileProps {
  image: string | null;
  index: number;
  loading: boolean;
  zoom: number;
  x: number;
  y: number;
  onTileClick: (event: React.MouseEvent<HTMLDivElement>, identifier: string) => void;
}

interface ImageGridProps {
  images: Array<string | null>;
  imageLoading: boolean[];
  zoom: number;
  x: number;
  y: number;
  onTileClick: (event: React.MouseEvent<HTMLDivElement>, identifier: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// SearchResultItem component
const SearchResultItem = ({ result, onLinkClick }: SearchResultItemProps) => {
  return (
    <div style={{
      marginBottom: '3px',
      paddingBottom: '3px',
      borderBottom: '1px solid #eee',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ flex: 1 }}>
        {result.name}
      </div>
      <div style={{ flex: 1, textAlign: 'right' }}>
        {result.link ? (
          <button
            // Fixed: Explicitly pass result.link which is now guaranteed to be a string
            onClick={() => onLinkClick(result.link, result.name)}
            style={{
              padding: '2px 6px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '11px',
              textDecoration: 'none',
              display: 'inline-block'
            }}
            title={`Go to location: ${result.link}`}
          >
            {result.link}
          </button>
        ) : (
          <span style={{ color: '#999', fontStyle: 'italic', fontSize: '11px' }}>No link</span>
        )}
      </div>
    </div>
  );
};

// SearchResultsList component
const SearchResultsList = ({ searchResults, onLinkClick }: SearchResultsListProps) => {
  if (searchResults.length === 0) return null;
  
  return (
    <div style={{
      marginTop: '10px',
      padding: '10px',
      backgroundColor: 'white',
      color: '#333',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px'
    }}>
      <div style={{
        maxHeight: '150px',
        overflowY: 'auto',
        padding: '5px'
      }}>
        {searchResults.map((result, index) => (
          <SearchResultItem 
            key={index} 
            result={result} 
            onLinkClick={onLinkClick}
          />
        ))}
      </div>
    </div>
  );
};

// NameListItem component
const NameListItem = ({ name, index, draggable, onDragStart, onRemove, isSelected }: NameListItemProps) => {
  return (
    <div
      key={index}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart(e, name) : undefined}
      style={{
        padding: '5px',
        margin: '2px 0',
        border: isSelected ? '1px solid #4caf50' : '1px solid #ddd',
        borderRadius: '3px',
        cursor: 'move',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}
    >
      <span>{name}</span>
      {isSelected && (
        <button
          onClick={() => onRemove(name)}
          style={{
            marginLeft: '10px',
            padding: '2px 8px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
};

// NamesList component
const NamesList = ({ 
  names, 
  draggable = true, 
  onDragStart, 
  onRemove,
  isSelected = false,
  height = '200px',
  onDragOver,
  onDrop,
  emptyMessage,
  loading = false
}: NamesListProps) => {
  return (
    <div
      style={{
        height: height,
        overflowY: 'auto',
        border: '1px solid #ccc',
        padding: '10px',
        borderRadius: '4px'
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div className="spinner"></div>
          <div style={{ marginTop: '10px' }}>Searching...</div>
        </div>
      ) : names.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          {emptyMessage}
        </div>
      ) : (
        names.map((name, index) => (
          <NameListItem
            key={index}
            name={name}
            index={index}
            draggable={draggable}
            onDragStart={onDragStart}
            onRemove={onRemove}
            isSelected={isSelected}
          />
        ))
      )}
    </div>
  );
};

// ImageTile component
const ImageTile = ({ 
  image, 
  index, 
  loading, 
  zoom, 
  x, 
  y, 
  onTileClick 
}: ImageTileProps) => {
  return (
    <div
      key={index}
      style={{ 
        width: '256px', 
        height: '256px', 
        backgroundColor: 'transparent', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        fontSize: '24px', 
        textAlign: 'center', 
        position: 'relative' 
      }}
      onClick={(event) => onTileClick(event, `${zoom}-${x + (index % 2)}-${y + Math.floor(index / 2)}`)}
    >
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <>
          {typeof image === 'string' && image.startsWith('data:image/png;base64,') ? (
            <img src={image} alt={`Tile ${index}`} style={{ width: '100%', height: '100%' }} />
          ) : (
            <div style={{ whiteSpace: 'pre' }}>{image}</div>
          )}
        </>
      )}
    </div>
  );
};

// ImageGrid component
const ImageGrid = ({ 
  images, 
  imageLoading, 
  zoom, 
  x, 
  y, 
  onTileClick,
  containerRef
}: ImageGridProps) => {
  return (
    <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 256px)', gridTemplateRows: 'repeat(2, 256px)', gap: '0', position: 'relative' }}>
      {images.map((image, index) => (
        <ImageTile
          key={index}
          image={image}
          index={index}
          loading={imageLoading[index]}
          zoom={zoom}
          x={x}
          y={y}
          onTileClick={onTileClick}
        />
      ))}
    </div>
  );
};

// Export all components
export {
  SearchResultItem,
  SearchResultsList,
  NameListItem,
  NamesList,
  ImageTile,
  ImageGrid
};