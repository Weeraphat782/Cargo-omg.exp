'use client';

import { useState, ChangeEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { browserAuthHeaders } from '@/lib/browser-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, AlertCircle, Camera, UploadCloud } from 'lucide-react';
import Image from 'next/image';

export default function ShipmentPhotoPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const quotationId = params.id as string;
  const linkToken = searchParams.get('token');

  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSuccess(null);
    setError(null);
    const files = event.target.files;
    if (files && files.length > 0) {
      setSelectedFiles(files);
      const newPreviewUrlsArray: string[] = [];
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          newPreviewUrlsArray.push(reader.result as string);
          if (newPreviewUrlsArray.length === files.length) {
            setPreviewUrls(newPreviewUrlsArray);
          }
        };
        reader.readAsDataURL(file);
      });
    } else {
      setSelectedFiles(null);
      setPreviewUrls([]);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select at least one photo to upload.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    Array.from(selectedFiles).forEach(file => {
      formData.append('shipmentPhoto', file);
    });
    formData.append('quotationId', quotationId);

    try {
      const response = await fetch('/api/upload-shipment-photo', {
        method: 'POST',
        headers: await browserAuthHeaders(linkToken),
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      let successMessage = result.message || `Successfully uploaded ${result.photoUrls?.length || 0} photo(s)!`;
      if (result.errors && result.errors.length > 0) {
        successMessage += ` With ${result.errors.length} error(s).`;
        console.warn('Uploads had errors:', result.errors);
      }
      setSuccess(successMessage);
      setSelectedFiles(null);
      setPreviewUrls([]);
    } catch (err) {
      console.error('Upload failed:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred during upload.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <div className="flex justify-center pt-6">
          <div className="relative w-[212px] h-[50px]">
            <Image 
              src="/logo.png" 
              alt="Company Logo" 
              fill
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
        </div>
        <CardHeader>
          <CardTitle className="text-2xl text-center font-bold">Shipment Photo Upload</CardTitle>
          <CardDescription className="text-center">
            For Quotation ID: <span className="font-semibold">{quotationId}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label htmlFor="shipment-photo-input" className="block text-sm font-medium text-gray-700 mb-1">
              Take or Select Photos:
            </label>
            <Input
              id="shipment-photo-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="cursor-pointer"
              disabled={isSubmitting}
              multiple
            />
            <p className="text-xs text-gray-500 mt-1">You can use your camera or select photos from your gallery.</p>
          </div>

          {previewUrls.length > 0 && (
            <div className="mt-4 border rounded-md p-2 bg-gray-50">
              <p className="text-sm font-medium text-gray-700 mb-2 text-center">Photo Preview(s):</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {previewUrls.map((url, index) => (
                  <div key={index} className="relative aspect-square">
                    <Image 
                      src={url} 
                      alt={`Selected photo preview ${index + 1}`} 
                      layout="fill"
                      objectFit="cover"
                      className="rounded-md"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert variant="default" className="mt-4 bg-green-50 border-green-200 text-green-700">
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <Button 
            onClick={handleSubmit} 
            disabled={!selectedFiles || selectedFiles.length === 0 || isSubmitting}
            className="w-full mt-6"
          >
            {isSubmitting ? (
              <>
                <span className="animate-spin mr-2">
                  <UploadCloud className="h-4 w-4" />
                </span>
                Uploading...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                Submit Photos
              </>
            )}
          </Button>
        </CardContent>
      </Card>
      <footer className="mt-8 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} Your Company Name. All rights reserved.</p>
      </footer>
    </div>
  );
} 