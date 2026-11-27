import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { authorizeQuotationWrite, readFileCaller } from '@/lib/file-access'
import { keyUnderQuotation, normalizeObjectKey } from '@/lib/file-access-rules'
import { sendTelegramDocumentUploadNotification } from '@/lib/telegram-admin-notify'
import { sendDocumentUploadNotification } from '@/lib/mail'
import { BOOKING_WEIGHT_DOC_TYPES, emitQuotationDocsUploaded } from '@/lib/webhooks'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// This route confirms a file upload (done via signed URL) and saves the DB record.
export async function POST(request: NextRequest) {
  const gate = await readFileCaller(request);
  if (!gate.ok) return gate.response;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server configuration error: Supabase client not initialized.' },
      { status: 500 }
    )
  }

  try {
    // Extract details needed for DB record from the request body
    const {
      filePath, // The path where the file was uploaded in storage
      quotationId,
      documentType,
      documentTypeName,
      originalFileName,
      notes,
      companyName,
      provider // Optional: 'supabase' or 'r2'
    } = await request.json()

    // Basic validation
    if (!filePath || !quotationId || !documentType || !documentTypeName || !originalFileName || !companyName) {
      return NextResponse.json(
        { error: 'Missing required data for database record.' },
        { status: 400 }
      )
    }

    const denied = await authorizeQuotationWrite(gate.caller, quotationId);
    if (denied) return denied;

    const storedKey = normalizeObjectKey(filePath);
    if (!keyUnderQuotation(storedKey, quotationId)) {
      return NextResponse.json({ error: 'File path does not belong to this shipment.' }, { status: 403 });
    }

    // Record the submission in the database
    const { data: dbData, error: dbError } = await supabase
      .from('document_submissions')
      .insert({
        quotation_id: quotationId,
        document_type: documentType,
        document_type_name: documentTypeName,
        file_name: originalFileName, // Always use original filename for display
        original_file_name: originalFileName,
        file_path: storedKey,
        file_url: '', // We will generate URL on the fly using getFileUrl helper
        notes: notes || null, // Ensure notes is null if empty/undefined
        company_name: companyName,
        storage_provider: provider || 'r2' // Default to r2 for new uploads if not specified
      }).select('id').single()

    if (dbError) {
      console.error('Supabase DB Insert Error (confirm-upload):', dbError)
      // Log the failure, but don't delete the file as it was uploaded successfully.
      // Consider implementing a cleanup mechanism for orphaned storage files later.
      return NextResponse.json(
        { error: `Database record failed: ${dbError.message}` },
        { status: 500 }
      )
    }

    if (dbData?.id && BOOKING_WEIGHT_DOC_TYPES.has(documentType)) {
      await emitQuotationDocsUploaded(supabase, quotationId, [documentType])
    }

    // ---> START: Update Quotation Status
    // Optionally, update the related quotation status after successful submission
    // (Check if this should happen on every submission or only the first/last one based on your logic)
    if (dbData?.id) {
      const { data: quoteStatusRow } = await supabase
        .from('quotations')
        .select('status')
        .eq('id', quotationId)
        .maybeSingle()

      const currentStatus = quoteStatusRow?.status as string | undefined
      // Keep pending_approval so staff approve flow (approveQuoteRequest) still matches status
      if (currentStatus && currentStatus !== 'pending_approval') {
        const { error: updateError } = await supabase
          .from('quotations')
          .update({ status: 'docs_uploaded' })
          .eq('id', quotationId)

        if (updateError) {
          console.error(`Failed to update quotation ${quotationId} status:`, updateError)
        } else {
          console.log(`Successfully updated quotation ${quotationId} status to docs_uploaded`)
        }
      } else if (currentStatus === 'pending_approval') {
        console.log(`Skipping quotation status update (${quotationId}): still pending_approval`)
      }
    }
    // ---> END: Update Quotation Status

    // Notify staff on Telegram (non-blocking for client if this fails)
    try {
      const { data: quoteRow } = await supabase
        .from('quotations')
        .select(
          'quotation_no, customer_name, company_name, destination, requested_destination'
        )
        .eq('id', quotationId)
        .maybeSingle()

      const { data: subsRows } = await supabase
        .from('document_submissions')
        .select('document_type_name')
        .eq('quotation_id', quotationId)

      const typeNames = [
        ...new Set(
          (subsRows ?? [])
            .map((r) => r.document_type_name)
            .filter((n): n is string => Boolean(n))
        ),
      ]
      const fileCount = subsRows?.length ?? 0

      const dest =
        quoteRow?.destination ||
        quoteRow?.requested_destination ||
        null
      const customerLabel =
        quoteRow?.customer_name ||
        quoteRow?.company_name ||
        companyName ||
        null

      // Prepare shared notification data
      const notifyData = {
        customerName: customerLabel,
        quotationNo: quoteRow?.quotation_no ?? null,
        documentTypes: typeNames.length > 0 ? typeNames : [documentTypeName],
        fileCount: fileCount > 0 ? fileCount : 1,
        destination: dest,
      };

      // Notify staff on Telegram (non-blocking)
      try {
        await sendTelegramDocumentUploadNotification({
          quotationId,
          ...notifyData,
        });
        console.log(`[confirm-upload] Telegram notification sent for quote ${quotationId}`);
      } catch (tgErr) {
        console.error('[confirm-upload] Telegram notification failed:', tgErr);
      }

      // Notify staff via Email (non-blocking)
      try {
        await sendDocumentUploadNotification(notifyData);
        console.log(`[confirm-upload] Email notification sent for quote ${quotationId}`);
      } catch (emailErr) {
        console.error('[confirm-upload] Email notification failed:', emailErr);
      }
    } catch (dataErr) {
      console.error('[confirm-upload] Failed to gather data for notifications:', dataErr);
    }

    // Success
    return NextResponse.json({
      success: true,
      message: 'Upload confirmed and record saved.',
      dbId: dbData?.id // Return the created database record ID
    })

  } catch (error) {
    console.error('API Route Error (confirm-upload):', error)
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
} 