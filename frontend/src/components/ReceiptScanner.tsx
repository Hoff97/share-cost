import { useState, useRef, useCallback } from 'react';
import {
  Modal, Button, Stack, Text, Group as MGroup, Loader, Alert,
  Paper, NumberInput, TextInput, ActionIcon, Center, FileButton,
  SegmentedControl, Badge, Divider,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { scanReceipt, type ScanReceiptResponse, type ReceiptItem } from '../api';

interface ReceiptScannerProps {
  token: string;
  opened: boolean;
  onClose: () => void;
  /** Called when the user confirms a single expense from the receipt total */
  onCreateSingle: (description: string, amount: number, date: string | null, currency: string | null) => void;
  /** Called when the user wants to create expenses per item — passes items one at a time */
  onCreateItems: (items: Array<{ description: string; amount: number; date: string | null }>, currency: string | null) => void;
}

type Phase = 'capture' | 'scanning' | 'review' | 'edit-items';

export function ReceiptScanner({ token, opened, onClose, onCreateSingle, onCreateItems }: ReceiptScannerProps) {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLButtonElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('capture');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanReceiptResponse | null>(null);

  // Editable fields for review
  const [editTitle, setEditTitle] = useState('');
  const [editTotal, setEditTotal] = useState<number>(0);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editCurrency, setEditCurrency] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<ReceiptItem[]>([]);

  // For sequential item editing
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [itemDescription, setItemDescription] = useState('');
  const [itemAmount, setItemAmount] = useState<number>(0);

  const reset = useCallback(() => {
    setPhase('capture');
    setError(null);
    setPreview(null);
    setResult(null);
    setEditTitle('');
    setEditTotal(0);
    setEditDate(null);
    setEditCurrency(null);
    setEditItems([]);
    setCurrentItemIndex(0);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const processImage = async (base64: string) => {
    setPhase('scanning');
    setError(null);
    try {
      const lang = i18n.language?.split('-')[0] || 'en';
      const data = await scanReceipt(token, base64, lang);
      setResult(data);
      setEditTitle(data.title);
      setEditTotal(data.total);
      setEditDate(data.date);
      setEditCurrency(data.currency);
      setEditItems(data.items.map(it => ({ ...it })));
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receiptScanFailed'));
      setPhase('capture');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Resize large images to reduce payload size
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // Downscale by factor 2 by default
        width = Math.round(width / 2);
        height = Math.round(height / 2);
        // Also cap at maxDim
        const maxDim = 2048;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        // Get base64 without the data:image/...;base64, prefix
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      setPreview(`data:image/jpeg;base64,${base64}`);
      await processImage(base64);
    } catch {
      setError(t('receiptScanFailed'));
    }
  };

  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  const handleCreateSingle = () => {
    onCreateSingle(editTitle, editTotal, editDate, editCurrency);
    handleClose();
  };

  const handleStartItemEdit = () => {
    if (editItems.length === 0) return;
    // Go straight to GroupDetail item-by-item flow (skip duplicate edit phase)
    onCreateItems(editItems.map(it => ({ ...it, date: editDate })), editCurrency);
    handleClose();
  };

  const handleItemNext = () => {
    // Save current item edits
    const updated = [...editItems];
    updated[currentItemIndex] = { description: itemDescription, amount: itemAmount };
    setEditItems(updated);

    if (currentItemIndex < editItems.length - 1) {
      const next = currentItemIndex + 1;
      setCurrentItemIndex(next);
      setItemDescription(editItems[next].description);
      setItemAmount(editItems[next].amount);
    }
  };

  const handleItemPrev = () => {
    // Save current item edits
    const updated = [...editItems];
    updated[currentItemIndex] = { description: itemDescription, amount: itemAmount };
    setEditItems(updated);

    if (currentItemIndex > 0) {
      const prev = currentItemIndex - 1;
      setCurrentItemIndex(prev);
      setItemDescription(updated[prev].description);
      setItemAmount(updated[prev].amount);
    }
  };

  const handleRemoveItem = () => {
    const updated = editItems.filter((_, i) => i !== currentItemIndex);
    setEditItems(updated);
    if (updated.length === 0) {
      setPhase('review');
      return;
    }
    const newIndex = Math.min(currentItemIndex, updated.length - 1);
    setCurrentItemIndex(newIndex);
    setItemDescription(updated[newIndex].description);
    setItemAmount(updated[newIndex].amount);
  };

  const handleConfirmItems = () => {
    // Save current edits first
    const updated = [...editItems];
    updated[currentItemIndex] = { description: itemDescription, amount: itemAmount };
    onCreateItems(updated.map(it => ({ ...it, date: editDate })), editCurrency);
    handleClose();
  };

  const modalTitle = phase === 'edit-items'
    ? `${t('receiptItem')} ${currentItemIndex + 1} / ${editItems.length}`
    : t('scanReceipt');

  return (
    <Modal opened={opened} onClose={handleClose} title={modalTitle} centered size="md">
      {/* Phase: Capture */}
      {phase === 'capture' && (
        <Stack gap="md">
          <Text size="sm" c="dimmed" ta="center">{t('receiptCaptureHint')}</Text>
          {error && <Alert color="red" variant="light">{error}</Alert>}

          <MGroup grow>
            {/* Camera capture — native camera on mobile */}
            <Button
              variant="light"
              onClick={() => cameraInputRef.current?.click()}
            >
              📷 {t('receiptCamera')}
            </Button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleCameraCapture}
            />

            {/* File upload */}
            <FileButton onChange={handleFile} accept="image/*">
              {(props) => (
                <Button variant="light" ref={fileInputRef} {...props}>
                  📁 {t('receiptUpload')}
                </Button>
              )}
            </FileButton>
          </MGroup>
        </Stack>
      )}

      {/* Phase: Scanning */}
      {phase === 'scanning' && (
        <Stack gap="md" align="center" py="xl">
          <Loader size="lg" />
          <Text size="sm" c="dimmed">{t('receiptScanning')}</Text>
          {preview && (
            <img
              src={preview}
              alt="Receipt"
              style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, opacity: 0.5 }}
            />
          )}
        </Stack>
      )}

      {/* Phase: Review */}
      {phase === 'review' && result && (
        <Stack gap="sm">
          {preview && (
            <Center>
              <img
                src={preview}
                alt="Receipt"
                style={{ maxWidth: '100%', maxHeight: 150, borderRadius: 8 }}
              />
            </Center>
          )}

          <TextInput
            label={t('description')}
            value={editTitle}
            onChange={(e) => setEditTitle(e.currentTarget.value)}
          />
          <NumberInput
            label={t('amount')}
            value={editTotal}
            onChange={(val) => setEditTotal(typeof val === 'number' ? val : 0)}
            decimalScale={2}
            min={0}
          />
          {editDate && (
            <TextInput
              label={t('date')}
              value={editDate}
              onChange={(e) => setEditDate(e.currentTarget.value)}
            />
          )}

          {editItems.length > 0 && (
            <>
              <Text size="sm" fw={500} mt="xs">{t('receiptItems')} ({editItems.length})</Text>
              <Paper withBorder p="xs" mah={200} style={{ overflowY: 'auto' }}>
                <Stack gap={4}>
                  {editItems.map((item, i) => (
                    <MGroup key={i} justify="space-between" wrap="nowrap">
                      <Text size="xs" lineClamp={1} style={{ flex: 1 }}>{item.description}</Text>
                      <Badge variant="light" size="sm">{item.amount.toFixed(2)}</Badge>
                    </MGroup>
                  ))}
                </Stack>
              </Paper>
            </>
          )}

          <Divider my="xs" />

          <Button fullWidth onClick={handleCreateSingle}>
            {t('receiptCreateSingle')}
          </Button>
          {editItems.length > 0 && (
            <Button fullWidth variant="light" onClick={handleStartItemEdit}>
              {t('receiptCreatePerItem')}
            </Button>
          )}
          <Button fullWidth variant="subtle" color="gray" onClick={reset}>
            {t('receiptRetry')}
          </Button>
        </Stack>
      )}

      {/* Phase: Edit Items (sequential) */}
      {phase === 'edit-items' && (
        <Stack gap="sm">
          <TextInput
            label={t('description')}
            value={itemDescription}
            onChange={(e) => setItemDescription(e.currentTarget.value)}
          />
          <NumberInput
            label={t('amount')}
            value={itemAmount}
            onChange={(val) => setItemAmount(typeof val === 'number' ? val : 0)}
            decimalScale={2}
            min={0}
          />
          {editDate && (
            <Text size="xs" c="dimmed">{t('date')}: {editDate}</Text>
          )}

          <MGroup justify="space-between" mt="xs">
            <Button
              variant="subtle"
              size="compact-sm"
              disabled={currentItemIndex === 0}
              onClick={handleItemPrev}
            >
              ← {t('receiptPrev')}
            </Button>
            <ActionIcon variant="light" color="red" onClick={handleRemoveItem} title={t('receiptRemoveItem')}>
              <Text size="xs">🗑</Text>
            </ActionIcon>
            {currentItemIndex < editItems.length - 1 ? (
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={handleItemNext}
              >
                {t('receiptNext')} →
              </Button>
            ) : (
              <Button
                size="compact-sm"
                onClick={handleConfirmItems}
              >
                {t('receiptConfirmAll')}
              </Button>
            )}
          </MGroup>

          <Button fullWidth variant="subtle" color="gray" mt="xs" onClick={() => setPhase('review')}>
            ← {t('receiptBackToReview')}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
