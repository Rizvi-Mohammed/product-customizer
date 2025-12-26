import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockStack, Button, DropZone, InlineStack, Text, Thumbnail, Spinner } from "@shopify/polaris";

type Props = {
  initialUrl?: string;
  uploading?: boolean;
  onFileSelected: (file: File | null) => void;
};

export function SimpleImagePicker({ initialUrl, uploading = false, onFileSelected }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(initialUrl);

  useEffect(() => {
    setPreviewUrl(initialUrl);
  }, [initialUrl]);

  // Revoke object URLs when they are replaced to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleDrop = useCallback(
    (_dropped, accepted) => {
      const [first] = accepted;
      if (!first) return;
      setFile(first);
      const url = URL.createObjectURL(first);
      setPreviewUrl(url);
      onFileSelected(first);
    },
    [onFileSelected],
  );

  const handleRemove = useCallback(() => {
    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setPreviewUrl(undefined);
    onFileSelected(null);
  }, [previewUrl, onFileSelected]);

  const fileName = useMemo(() => file?.name, [file]);

  return (
    <BlockStack gap="150">
      <DropZone accept="image/*" type="image" allowMultiple={false} onDrop={handleDrop} disabled={uploading}>
        <DropZone.FileUpload actionHint={uploading ? "Uploading..." : "Upload an image"} />
      </DropZone>
      {uploading && (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text tone="subdued" variant="bodySm">Uploading image...</Text>
        </InlineStack>
      )}
      {previewUrl && (
        <InlineStack gap="150" blockAlign="center">
          <Thumbnail alt={fileName || "Selected image"} size="small" source={previewUrl} />
          {fileName && <Text as="span">{fileName}</Text>}
          <Button tone="critical" onClick={handleRemove} disabled={uploading}>
            Remove
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
