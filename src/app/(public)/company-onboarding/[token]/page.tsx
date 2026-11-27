'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCompanyByToken, Company } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Loader2, Upload, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { browserAuthHeaders } from '@/lib/browser-auth';

export default function CompanyOnboardingPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    const supabase = createClientComponentClient();

    const [company, setCompany] = useState<Company | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        address: '',
        tax_id: '',
        contact_person: '',
        contact_phone: '',
        contact_email: '',
    });
    const [files, setFiles] = useState<File[]>([]);

    useEffect(() => {
        async function loadCompany() {
            if (!token) return;
            try {
                const data = await getCompanyByToken(token);
                if (data) {
                    setCompany(data);
                    setFormData({
                        address: data.address || '',
                        tax_id: data.tax_id || '',
                        contact_person: data.contact_person || '',
                        contact_phone: data.contact_phone || '',
                        contact_email: data.contact_email || '',
                    });
                } else {
                    setError('Invalid or expired onboarding link.');
                }
            } catch (err) {
                console.error('Error loading company:', err);
                setError('Failed to load company information.');
            } finally {
                setLoading(false);
            }
        }
        loadCompany();
    }, [token]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setFiles(Array.from(e.target.files));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!company) return;

        setSubmitting(true);
        try {
            // 1. Upload files to Cloudflare R2 via signed URLs
            const uploadedPaths: string[] = [];
            for (const file of files) {
                // Get signed URL
                const response = await fetch('/api/generate-upload-url', {
                    method: 'POST',
                    headers: await browserAuthHeaders(token, { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        fileName: file.name,
                        contentType: file.type,
                        companyId: company.id,
                        documentType: 'registration-docs',
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to get upload URL');
                }

                const { signedUrl, path } = await response.json();

                // Upload to R2
                const uploadResponse = await fetch(signedUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': file.type },
                    body: file,
                });

                if (!uploadResponse.ok) {
                    throw new Error('Failed to upload file to storage');
                }

                uploadedPaths.push(path);
            }

            // 2. Update company record
            const { error: updateError } = await supabase
                .from('companies')
                .update({
                    ...formData,
                    registration_docs: uploadedPaths.length > 0 ? uploadedPaths : company.registration_docs,
                    storage_provider: 'r2',
                    is_approved: true,
                    updated_at: new Date().toISOString(),
                })
                .eq('onboarding_token', token);

            if (updateError) throw updateError;

            setSubmitted(true);
            toast.success('Information submitted successfully!');
        } catch (err: unknown) {
            interface HandledError {
                message?: string;
                details?: string;
                hint?: string;
                code?: string;
            }
            const errorObj = err as HandledError;
            console.error('Submission error details:', {
                message: errorObj.message,
                details: errorObj.details,
                hint: errorObj.hint,
                code: errorObj.code,
                error: err
            });
            toast.error(errorObj.message || 'Failed to submit information.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <Card className="w-full max-w-md border-red-100 bg-red-50">
                    <CardHeader>
                        <div className="flex items-center gap-2 text-red-600 mb-2">
                            <AlertCircle className="h-6 w-6" />
                            <CardTitle>Link Error</CardTitle>
                        </div>
                        <CardDescription className="text-red-700 font-medium">
                            {error}
                        </CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <Button className="w-full" onClick={() => router.push('/')}>Go Home</Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <Card className="w-full max-w-md text-center py-8">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                            <div className="bg-green-100 p-3 rounded-full">
                                <CheckCircle2 className="h-12 w-12 text-green-600" />
                            </div>
                        </div>
                        <CardTitle className="text-2xl font-bold text-slate-900">Thank You!</CardTitle>
                        <CardDescription className="text-slate-600 text-lg">
                            Your information for <span className="font-bold text-blue-600">{company?.name}</span> has been submitted and approved.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-slate-500">
                            Our team will review your documents if necessary. You can now close this window.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-extrabold text-slate-900">Company Onboarding</h1>
                    <p className="mt-2 text-lg text-slate-600">
                        Please provide the details for <span className="font-bold text-blue-600">{company?.name}</span>
                    </p>
                </div>

                <Card className="shadow-lg border-slate-200">
                    <form onSubmit={handleSubmit}>
                        <CardHeader>
                            <CardTitle>Company Information</CardTitle>
                            <CardDescription>All fields are required for company verification.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="address">Registered Address</Label>
                                    <Textarea
                                        id="address"
                                        placeholder="Full legal address"
                                        required
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="tax_id">Tax ID / Registration No.</Label>
                                    <Input
                                        id="tax_id"
                                        required
                                        value={formData.tax_id}
                                        onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="contact_person">Contact Person</Label>
                                    <Input
                                        id="contact_person"
                                        required
                                        value={formData.contact_person}
                                        onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="contact_phone">Contact Phone</Label>
                                    <Input
                                        id="contact_phone"
                                        type="tel"
                                        required
                                        value={formData.contact_phone}
                                        onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="contact_email">Contact Email</Label>
                                    <Input
                                        id="contact_email"
                                        type="email"
                                        required
                                        value={formData.contact_email}
                                        onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t">
                                <Label className="text-base font-bold">Company Documents</Label>
                                <p className="text-xs text-slate-500 mb-2">
                                    Please upload company registration (DBD), Tax ID certificate, etc. (PDF or Images)
                                </p>
                                <div className="flex items-center justify-center w-full">
                                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            <Upload className="w-8 h-8 mb-3 text-slate-400" />
                                            <p className="mb-2 text-sm text-slate-500">
                                                <span className="font-semibold">Click to upload</span> or drag and drop
                                            </p>
                                            <p className="text-xs text-slate-400">PDF, PNG, JPG (MAX. 10MB)</p>
                                        </div>
                                        <input
                                            type="file"
                                            className="hidden"
                                            multiple
                                            onChange={handleFileChange}
                                        />
                                    </label>
                                </div>
                                {files.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                        <p className="text-xs font-semibold text-slate-700">Selected files:</p>
                                        {files.map((file, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-xs text-slate-600">
                                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col items-stretch gap-4 border-t pt-6 bg-slate-50/50">
                            <Button
                                type="submit"
                                className="w-full h-12 text-lg font-bold bg-blue-600 hover:bg-blue-700 shadow-md transition-all active:scale-[0.98]"
                                disabled={submitting || files.length === 0}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    'Submit Information & Documents'
                                )}
                            </Button>
                            <p className="text-[10px] text-center text-slate-400 italic">
                                By submitting, you verify that the information provided is accurate and representative of the company.
                            </p>
                        </CardFooter>
                    </form>
                </Card>
            </div>
        </div>
    );
}
