# Ingestion Service — PDF extraction with OCR fallback

import os
from datetime import date, datetime
from typing import List, Tuple
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CommitteeReport, ReportEntry

# Note: These imports require the actual Python packages
# pip install pdfplumber pytesseract Pillow

async def ingest_report(
    db: AsyncSession,
    bill_ref: str,
    institution: str,
    file_path: str,
    date_tabled: str | date
) -> CommitteeReport:
    """Ingest a committee report PDF."""

    if isinstance(date_tabled, str):
        try:
            date_tabled = date.fromisoformat(date_tabled)
        except ValueError as exc:
            raise ValueError("date_tabled must use YYYY-MM-DD format") from exc
    elif isinstance(date_tabled, datetime):
        date_tabled = date_tabled.date()
    
    # Create report record
    report = CommitteeReport(
        bill_ref=bill_ref,
        institution=institution,
        date_tabled=date_tabled,
        source_document_ref=os.path.basename(file_path),
        extraction_status="pending"
    )
    db.add(report)
    await db.flush()
    
    # Extract text
    text, ocr_used = extract_text(file_path)
    report.ocr_used = ocr_used
    
    # Parse into entries
    entries = parse_report_entries(text)
    
    for clause_ref, summary, treatment, reason in entries:
        entry = ReportEntry(
            report_ref=report.id,
            clause_ref=clause_ref,
            extracted_summary=summary,
            treatment=treatment,
            stated_reason=reason
        )
        db.add(entry)
    
    report.extraction_status = "ocr_used" if ocr_used else "extracted"
    
    await db.commit()
    await db.refresh(report)
    
    return report

def extract_text(file_path: str) -> Tuple[str, bool]:
    """Extract text from PDF with OCR fallback."""
    try:
        import pdfplumber
        
        text = ""
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        
        # Check if text is sufficient
        if len(text.strip()) > 100:
            return text, False
        
        # OCR fallback
        return ocr_extract(file_path), True
        
    except Exception as e:
        # Fallback to OCR
        return ocr_extract(file_path), True

def ocr_extract(file_path: str) -> str:
    """Extract text using Tesseract OCR."""
    try:
        import pytesseract
        from pdf2image import convert_from_path
        
        images = convert_from_path(file_path)
        text = ""
        
        for image in images:
            page_text = pytesseract.image_to_string(image)
            text += page_text + "\n"
        
        return text
        
    except Exception as e:
        raise RuntimeError(f"OCR extraction failed: {e}")

def parse_report_entries(text: str) -> List[Tuple[str, str, str, str]]:
    """Parse report text into structured entries."""
    # This is a simplified parser - real implementation would be more sophisticated
    entries = []
    
    # Look for patterns like "Clause X: ..." or "Section Y: ..."
    lines = text.split('\n')
    current_clause = None
    current_summary = []
    current_treatment = None
    current_reason = None
    
    for line in lines:
        line = line.strip()
        
        # Detect clause reference
        if line.startswith('Clause ') or line.startswith('Section '):
            # Save previous entry
            if current_clause and current_summary:
                entries.append((
                    current_clause,
                    ' '.join(current_summary),
                    current_treatment or 'not addressed',
                    current_reason
                ))
            
            current_clause = line.split(':')[0] if ':' in line else line
            current_summary = []
            current_treatment = None
            current_reason = None
        elif current_clause:
            # Detect treatment keywords
            lower_line = line.lower()
            if 'adopted' in lower_line:
                current_treatment = 'adopted'
            elif 'amended' in lower_line:
                current_treatment = 'amended'
            elif 'rejected' in lower_line:
                current_treatment = 'rejected with reasons'
            
            # Accumulate summary
            if line and not line.startswith('Reason:'):
                current_summary.append(line)
            elif line.startswith('Reason:'):
                current_reason = line.replace('Reason:', '').strip()
    
    # Save last entry
    if current_clause and current_summary:
        entries.append((
            current_clause,
            ' '.join(current_summary),
            current_treatment or 'not addressed',
            current_reason
        ))
    
    return entries
