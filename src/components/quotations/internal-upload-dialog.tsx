'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilePlus, Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getPresetFlat, normalizeCommodityType, type CommodityType } from '@/lib/document-presets';
import { browserAuthHeaders } from '@/lib/browser-auth';

interface InternalUploadDialogProps {
    quotationId: string;
    companyName: string;
    commodityType?: CommodityType | string | null;
    includeMsds?: boolean;
    onUploadSuccess: () => void;
}

export function InternalUploadDialog({
    quotationId,
    companyName,
    commodityType: commodityTypeProp,
    includeMsds = false,
    onUploadSuccess,
}: InternalUploadDialogProps) {
    const commodityType = normalizeCommodityType(commodityTypeProp ?? undefined);
    const docTypes = useMemo(
        () => getPresetFlat(commodityType, includeMsds),
        [commodityType, includeMsds]
    );
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [documentType, setDocumentType] = useState<string>('');
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const handleUpload = async () => {
        if (!file || !documentType) {
            setError('Please select both a file and a document type.');
            return;
        }

        setIsUploading(true);
        setError(null);

        try {
            // 1. Get Signed URL
            const generateUrlResponse = await fetch('/api/generate-upload-url', {
                method: 'POST',
                headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    quotationId: quotationId,
                    documentType: documentType,
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

            // 3. Confirm Upload
            const docTypeObj = docTypes.find(t => t.id === documentType);
            const confirmResponse = await fetch('/api/confirm-upload', {
                method: 'POST',
                headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    filePath,
                    quotationId,
                    documentType,
                    documentTypeName: docTypeObj?.name || documentType,
                    originalFileName: file.name,
                    companyName,
                    provider, // Store the provider (r2)
                }),
            });

            if (!confirmResponse.ok) throw new Error('Failed to confirm upload');

            toast.success('Document uploaded successfully');
            setOpen(false);
            setFile(null);
            setDocumentType('');
            onUploadSuccess();
        } catch (err: unknown) {
            console.error('Upload error:', err);
            const errorMessage = err instanceof Error ? err.message : 'An error occurred during upload';
            setError(errorMessage);
            toast.error('Upload failed');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-[10px] font-black uppercase tracking-widest gap-1.5 border-emerald-200 text-emerald-700 bg-emerald-50/30 hover:bg-emerald-50 hover:border-emerald-300">
                    <FilePlus className="h-3.5 w-3.5" />
                    Add Document
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Upload className="h-5 w-5 text-emerald-600" />
                        Internal Document Upload
                    </DialogTitle>
                    <DialogDescription>
                        Manually upload a document for this quotation. This will be visible to everyone.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="doc-type" className="text-xs font-bold uppercase tracking-wider text-slate-500">Document Type</Label>
                        <Select value={documentType} onValueChange={setDocumentType}>
                            <SelectTrigger id="doc-type" className="w-full">
                                <SelectValue placeholder="Select document type" />
                            </SelectTrigger>
                            <SelectContent>
                                {docTypes.map((type) => (
                                    <SelectItem key={type.id} value={type.id}>
                                        {type.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="file-upload" className="text-xs font-bold uppercase tracking-wider text-slate-500">File</Label>
                        <Input
                            id="file-upload"
                            type="file"
                            onChange={handleFileChange}
                            disabled={isUploading}
                            className="text-xs"
                        />
                        {file && (
                            <p className="text-[10px] text-slate-500 font-medium italic">
                                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                            </p>
                        )}
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-xs font-medium border border-red-100">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {error}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="submit"
                        disabled={isUploading || !file || !documentType}
                        onClick={handleUpload}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold"
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Confirm Internal Upload
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
