'use client';

import React, { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getFileUrl } from '@/lib/storage';
import { browserAuthHeaders } from '@/lib/browser-auth';
import { FileText, Upload, X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';


interface ShippingDocumentsUploadProps {
  quotationId: string;
  awbFileUrl?: string | null;
  awbFileName?: string | null;
  awbUploadedAt?: string | null;
  customsDeclarationFileUrl?: string | null;
  customsDeclarationFileName?: string | null;
  customsDeclarationUploadedAt?: string | null;
  storageProvider?: 'supabase' | 'r2';
  onUpdate?: () => void;
}

type DocType = 'awb' | 'customs_declaration';

export function ShippingDocumentsUpload({
  quotationId,
  awbFileUrl,
  awbFileName,
  awbUploadedAt,
  customsDeclarationFileUrl,
  customsDeclarationFileName,
  customsDeclarationUploadedAt,
  storageProvider = 'supabase',
  onUpdate,
}: ShippingDocumentsUploadProps) {
  const [uploadingAwb, setUploadingAwb] = useState(false);
  const [uploadingCustoms, setUploadingCustoms] = useState(false);
  const [deletingAwb, setDeletingAwb] = useState(false);
  const [deletingCustoms, setDeletingCustoms] = useState(false);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

  const awbInputRef = useRef<HTMLInputElement>(null);
  const customsInputRef = useRef<HTMLInputElement>(null);

  // Resolve URLs on mount or when props change
  React.useEffect(() => {
    async function resolveUrls() {
      const urls: Record<string, string> = {};
      if (awbFileUrl) {
        // We need the path. Legacy Supabase path might be stored in awb_file_url if it's a public URL or path.
        // For new R2 files, we might need to store the path specifically.
        // Assuming the logic in getFileUrl can handle the path.
        const path = awbFileUrl.includes('supabase') ? awbFileUrl.split('/public/')[1] || awbFileUrl : awbFileUrl;
        urls.awb = await getFileUrl(path, storageProvider);
      }
      if (customsDeclarationFileUrl) {
        const path = customsDeclarationFileUrl.includes('supabase') ? customsDeclarationFileUrl.split('/public/')[1] || customsDeclarationFileUrl : customsDeclarationFileUrl;
        urls.customs = await getFileUrl(path, storageProvider);
      }
      setResolvedUrls(urls);
    }
    resolveUrls();
  }, [awbFileUrl, customsDeclarationFileUrl, storageProvider]);

  const handleUpload = async (file: File, docType: DocType) => {
    const setUploading = docType === 'awb' ? setUploadingAwb : setUploadingCustoms;
    setUploading(true);

    try {
      // 1. Get Signed URL
      const generateUrlResponse = await fetch('/api/generate-upload-url', {
        method: 'POST',
        headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          quotationId: quotationId,
          documentType: docType,
        }),
      });

      if (!generateUrlResponse.ok) throw new Error('Failed to get upload URL');
      const { signedUrl, path: filePath, provider } = await generateUrlResponse.json();

      // 2. Upload to Storage
      const storageResponse = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!storageResponse.ok) throw new Error('Storage upload failed');

      // 3. Update Quotation Record
      const updateData: Record<string, string> = {
        storage_provider: provider || 'r2'
      };
      if (docType === 'awb') {
        updateData.awb_file_url = filePath;
        updateData.awb_file_name = file.name;
        updateData.awb_uploaded_at = new Date().toISOString();
      } else {
        updateData.customs_declaration_file_url = filePath;
        updateData.customs_declaration_file_name = file.name;
        updateData.customs_declaration_uploaded_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('quotations')
        .update(updateData)
        .eq('id', quotationId);

      if (error) throw error;

      toast.success(`${docType === 'awb' ? 'AWB' : 'Customs Declaration'} uploaded successfully`);
      onUpdate?.();
    } catch (err) {
      console.error('Upload error:', err);
      toast.error(`Failed to upload ${docType === 'awb' ? 'AWB' : 'Customs Declaration'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docType: DocType) => {
    const setDeleting = docType === 'awb' ? setDeletingAwb : setDeletingCustoms;
    setDeleting(true);

    try {
      // 1. Delete physical file from storage
      const { deleteFile } = await import('@/lib/storage');
      const currentFileUrl = docType === 'awb' ? awbFileUrl : customsDeclarationFileUrl;

      if (currentFileUrl) {
        // Document submissions are in 'documents' bucket
        // If it's a Supabase path/URL, deleteFile handles extraction. 
        // For new R2 files, currentFileUrl IS the path.
        await deleteFile('documents', currentFileUrl, storageProvider);
        console.log(`Deleted ${docType} file from ${storageProvider}: ${currentFileUrl}`);
      }

      // 2. Update database
      const updateData: Record<string, null> = {};
      if (docType === 'awb') {
        updateData.awb_file_url = null;
        updateData.awb_file_name = null;
        updateData.awb_uploaded_at = null;
      } else {
        updateData.customs_declaration_file_url = null;
        updateData.customs_declaration_file_name = null;
        updateData.customs_declaration_uploaded_at = null;
      }

      const { error } = await supabase
        .from('quotations')
        .update(updateData)
        .eq('id', quotationId);

      if (error) throw error;

      toast.success(`${docType === 'awb' ? 'AWB' : 'Customs Declaration'} removed`);
      onUpdate?.();
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(`Failed to remove ${docType === 'awb' ? 'AWB' : 'Customs Declaration'}`);
    } finally {
      setDeleting(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, docType: DocType) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file, docType);
    }
    e.target.value = '';
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('th-TH', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const renderDocRow = (
    label: string,
    icon: React.ReactNode,
    fileUrl: string | null | undefined,
    fileName: string | null | undefined,
    uploadedAt: string | null | undefined,
    uploading: boolean,
    deleting: boolean,
    inputRef: React.RefObject<HTMLInputElement>,
    docType: DocType
  ) => {
    const hasFile = !!fileUrl;

    return (
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-100 bg-white hover:border-gray-200 transition-colors">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${hasFile ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{label}</span>
              {hasFile ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              )}
            </div>
            {hasFile ? (
              <div className="text-[11px] text-gray-500 truncate mt-0.5">
                {fileName} <span className="text-gray-300 mx-1">•</span> {formatDate(uploadedAt)}
              </div>
            ) : (
              <div className="text-[11px] text-gray-400 mt-0.5">Not uploaded yet</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasFile && (
            <>
              <a href={docType === 'awb' ? resolvedUrls.awb : resolvedUrls.customs} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 border-gray-200">
                  <Download className="w-3.5 h-3.5 text-gray-500" />
                </Button>
              </a>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 border-red-200 hover:bg-red-50 hover:text-red-600"
                onClick={() => handleDelete(docType)}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5 text-red-400" />}
              </Button>
            </>
          )}
          <Button
            variant={hasFile ? 'outline' : 'default'}
            size="sm"
            className={`h-7 text-[11px] font-bold ${hasFile ? 'border-gray-200' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            ) : (
              <Upload className="w-3.5 h-3.5 mr-1" />
            )}
            {hasFile ? 'Replace' : 'Upload'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            className="hidden"
            onChange={(e) => onFileChange(e, docType)}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-4 bg-blue-600 rounded-full" />
        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Shipping Documents (Internal)</span>
      </div>

      {renderDocRow(
        'AWB (Air Waybill)',
        <FileText className="w-4 h-4" />,
        awbFileUrl,
        awbFileName,
        awbUploadedAt,
        uploadingAwb,
        deletingAwb,
        awbInputRef,
        'awb'
      )}

      {renderDocRow(
        'Customs Declaration',
        <FileText className="w-4 h-4" />,
        customsDeclarationFileUrl,
        customsDeclarationFileName,
        customsDeclarationUploadedAt,
        uploadingCustoms,
        deletingCustoms,
        customsInputRef,
        'customs_declaration'
      )}
    </div>
  );
}
