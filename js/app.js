/**
 * INVOXA - V2 App Logic
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- Element References ---
    // Form fields
    const fields = {
        bizName: document.getElementById('bizName'),
        logoUrl: document.getElementById('logoUrl'),
        bizAddress: document.getElementById('bizAddress'),
        bizEmail: document.getElementById('bizEmail'),
        bizPhone: document.getElementById('bizPhone'),
        bizWebsite: document.getElementById('bizWebsite'),

        invoiceNumber: document.getElementById('invoiceNumber'),
        currency: document.getElementById('currency'),
        issueDate: document.getElementById('issueDate'),
        dueDate: document.getElementById('dueDate'),
        poNumber: document.getElementById('poNumber'),
        invoiceStatus: document.getElementById('invoiceStatus'),

        clientName: document.getElementById('clientName'),
        clientCompany: document.getElementById('clientCompany'),
        clientAddress: document.getElementById('clientAddress'),
        clientEmail: document.getElementById('clientEmail'),
        clientPhone: document.getElementById('clientPhone'),

        paymentTerms: document.getElementById('paymentTerms'),
        notes: document.getElementById('notes'),
        bankDetails: document.getElementById('bankDetails'),

        discount: document.getElementById('discount'),
        tax: document.getElementById('tax'),
        shipping: document.getElementById('shipping')
    };

    // Preview elements
    const prev = {
        invLogoWrap: document.getElementById('invLogoWrap'),
        invLogo: document.getElementById('invLogo'),
        invCompanyName: document.getElementById('invCompanyName'),
        invCompanyAddr: document.getElementById('invCompanyAddr'),
        invCompanyContact: document.getElementById('invCompanyContact'),

        invNumber: document.getElementById('invNumber'),
        invStatusBadge: document.getElementById('invStatusBadge'),
        invIssueDate: document.getElementById('invIssueDate'),
        invDueDate: document.getElementById('invDueDate'),
        invPORow: document.getElementById('invPORow'),
        invPO: document.getElementById('invPO'),

        invClientName: document.getElementById('invClientName'),
        invClientCompany: document.getElementById('invClientCompany'),
        invClientAddr: document.getElementById('invClientAddr'),
        invClientContact: document.getElementById('invClientContact'),

        invTerms: document.getElementById('invTerms'),
        invNotes: document.getElementById('invNotes'),
        invBank: document.getElementById('invBank'),

        invSub: document.getElementById('invSub'),
        invDiscRow: document.getElementById('invDiscRow'),
        invDiscLbl: document.getElementById('invDiscLbl'),
        invDiscVal: document.getElementById('invDiscVal'),
        invShipRow: document.getElementById('invShipRow'),
        invShipVal: document.getElementById('invShipVal'),
        invTaxRow: document.getElementById('invTaxRow'),
        invTaxLbl: document.getElementById('invTaxLbl'),
        invTaxVal: document.getElementById('invTaxVal'),
        invGrand: document.getElementById('invGrand'),

        // Summary panel (right col)
        spSub: document.getElementById('spSub'),
        spDiscRow: document.getElementById('spDiscRow'),
        spDiscLbl: document.getElementById('spDiscLbl'),
        spDiscVal: document.getElementById('spDiscVal'),
        spShipRow: document.getElementById('spShipRow'),
        spShipVal: document.getElementById('spShipVal'),
        spTaxRow: document.getElementById('spTaxRow'),
        spTaxLbl: document.getElementById('spTaxLbl'),
        spTaxVal: document.getElementById('spTaxVal'),
        spGrand: document.getElementById('spGrand')
    };

    // Line items
    const itemsContainer = document.getElementById('itemsContainer');
    const invTbody = document.getElementById('invTbody');
    const addItemBtn = document.getElementById('addItemBtn');

    // Interactive UI
    const secHeaders = document.querySelectorAll('.sec-header');
    const themeSwatches = document.querySelectorAll('.swatch');

    let lineItems = [{ desc: 'Web Design Services', qty: 1, rate: 1000 }];
    let currentThemeColor = '#5b5ef4'; // Default indigo
    let logoDataUrl = ''; // Store base64 loaded image

    // --- Initialize UI ---

    // Set default dates
    const today = new Date();
    fields.issueDate.valueAsDate = today;
    const nextMonth = new Date(today);
    nextMonth.setDate(nextMonth.getDate() + 30);
    fields.dueDate.valueAsDate = nextMonth;

    // Accordion semantics
    secHeaders.forEach(btn => {
        btn.addEventListener('click', () => {
            const body = btn.nextElementSibling;
            body.classList.toggle('open');
        });
    });

    // Theme setup
    themeSwatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            themeSwatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            currentThemeColor = swatch.dataset.color;
            document.documentElement.style.setProperty('--accent', currentThemeColor);
            document.getElementById('invAccentLabel').style.color = currentThemeColor;
            document.getElementById('invRule').style.background = currentThemeColor;
            showToast('Theme updated');
        });
    });

    // Logo Shape setup
    const shapeBtns = document.querySelectorAll('.shape-btn');
    shapeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            shapeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const shape = btn.dataset.shape;
            prev.invLogoWrap.className = `inv-logo-wrap logo-shape-${shape}`;
            showToast('Logo shape updated');
        });
    });

    // Listen to inputs
    Object.values(fields).forEach(input => {
        if (input) {
            // Special handling for the file input
            if (input.id === 'logoUrl') {
                input.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                            logoDataUrl = evt.target.result;
                            updatePreview();
                        };
                        reader.readAsDataURL(file);
                    } else {
                        logoDataUrl = '';
                        updatePreview();
                    }
                });
            } else {
                input.addEventListener('input', updatePreview);
                if (input.tagName === 'SELECT') {
                    input.addEventListener('change', updatePreview);
                }
            }
        }
    });

    // --- Line Items Logic ---

    function renderLineItemsForm() {
        itemsContainer.innerHTML = '';
        lineItems.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'item-row';
            row.innerHTML = `
        <div style="flex:1; position:relative;">
            <input type="text" style="width:100%; padding-right:36px;" class="ir-desc" value="${item.desc}" placeholder="Item description" data-idx="${index}" data-fld="desc">
            <button type="button" class="ai-wand" title="AI Expand Description" data-idx="${index}">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1v4M8 11v4M1 8h4M11 8h4M3 3l2.5 2.5M10.5 10.5L13 13M3 13l2.5-2.5M10.5 5.5L13 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
        <input type="number" class="ir-qty" value="${item.qty}" min="1" data-idx="${index}" data-fld="qty">
        <input type="number" class="ir-rate" value="${item.rate}" min="0" step="0.01" data-idx="${index}" data-fld="rate">
        <div class="ir-total">${formatMoney(item.qty * item.rate)}</div>
        <button type="button" class="ir-del" data-idx="${index}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
             <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      `;
            itemsContainer.appendChild(row);
        });

        // Add events
        itemsContainer.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = e.target.dataset.idx;
                const fld = e.target.dataset.fld;
                const val = e.target.value;
                lineItems[idx][fld] = fld === 'desc' ? val : Number(val);
                updatePreview();
            });
        });

        itemsContainer.querySelectorAll('.ir-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.idx);
                lineItems.splice(idx, 1);
                renderLineItemsForm();
                updatePreview();
            });
        });

        // AI Magic Wand Logic
        itemsContainer.querySelectorAll('.ai-wand').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.idx);
                const currentText = lineItems[idx].desc.trim();

                if (!currentText) {
                    showToast('Type a short description first to use AI');
                    return;
                }

                showToast('✨ AI is expanding description...');
                btn.style.opacity = '0.5';

                // Simulate network request latency
                setTimeout(() => {
                    // Simple mock AI expansion for demo purposes
                    const mockExpansions = {
                        "web design": "Custom responsive website design including wireframes, high-fidelity mockups, and client revisions.",
                        "development": "Frontend and backend development, API integration, and database architecture setup.",
                        "seo": "Comprehensive technical SEO audit, keyword research strategy, and on-page optimization.",
                        "marketing": "Digital marketing campaign strategy, ad copywriting, and social media scheduling."
                    };

                    let expanded = `Professional ${currentText.toLowerCase()} services and consultation.`;
                    for (const [key, val] of Object.entries(mockExpansions)) {
                        if (currentText.toLowerCase().includes(key)) {
                            expanded = val;
                            break;
                        }
                    }

                    lineItems[idx].desc = expanded;
                    renderLineItemsForm();
                    updatePreview();
                    showToast('✨ AI expansion complete');
                }, 1000);
            });
        });
    }

    addItemBtn.addEventListener('click', () => {
        lineItems.push({ desc: '', qty: 1, rate: 0 });
        renderLineItemsForm();
        updatePreview();
    });

    // --- AI Smart Notes Logic ---
    const aiNotesBtn = document.getElementById('aiNotesBtn');
    if (aiNotesBtn) {
        aiNotesBtn.addEventListener('click', () => {
            const clientName = fields.clientName.value || 'Client';

            showToast('✨ Generating smart note...');
            aiNotesBtn.style.opacity = '0.5';

            setTimeout(() => {
                const notes = [
                    `Hi ${clientName}, it's been a pleasure working with you! Please let me know if you have any questions regarding this invoice.`,
                    `Thank you for your business, ${clientName}. We truly appreciate your prompt payment and look forward to future collaborations.`,
                    `Dear ${clientName}, please find the attached invoice for recent services rendered. We appreciate your timely payment within the terms specified.`
                ];

                // Pick a random note
                const randomNote = notes[Math.floor(Math.random() * notes.length)];
                fields.notes.value = randomNote;

                aiNotesBtn.style.opacity = '1';
                updatePreview();
                showToast('✨ Note generated successfully');
            }, 1000);
        });
    }


    // --- Core Preview Logic ---

    // Security: Basic HTML sanitizer to prevent XSS injection into the DOM
    function sanitize(str) {
        if (!str) return '';
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    function formatMoney(amount) {
        const sym = fields.currency.value;
        return sym + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function updatePreview() {
        // Top section
        if (logoDataUrl) {
            prev.invLogoWrap.style.display = 'block';
            prev.invLogo.src = logoDataUrl;
        } else {
            prev.invLogoWrap.style.display = 'none';
        }

        prev.invCompanyName.innerHTML = sanitize(fields.bizName.value) || 'Your Company Name';
        prev.invCompanyAddr.innerHTML = sanitize(fields.bizAddress.value).replace(/\n/g, '<br>');

        let contact = [];
        if (fields.bizEmail.value) contact.push(sanitize(fields.bizEmail.value));
        if (fields.bizPhone.value) contact.push(sanitize(fields.bizPhone.value));
        if (fields.bizWebsite.value) contact.push(sanitize(fields.bizWebsite.value));
        prev.invCompanyContact.innerHTML = contact.join(' &bull; ');

        // Meta
        prev.invNumber.innerHTML = '#' + sanitize(fields.invoiceNumber.value || '000');
        prev.invStatusBadge.innerHTML = sanitize(fields.invoiceStatus.value);
        // status color
        prev.invStatusBadge.className = 'inv-status ' + fields.invoiceStatus.value.toLowerCase();

        const fmtDt = dt => dt ? new Date(dt).toLocaleDateString() : '';
        prev.invIssueDate.textContent = fmtDt(fields.issueDate.value);
        prev.invDueDate.textContent = fmtDt(fields.dueDate.value);

        if (fields.poNumber.value) {
            prev.invPORow.style.display = 'table-row';
            prev.invPO.innerHTML = sanitize(fields.poNumber.value);
        } else {
            prev.invPORow.style.display = 'none';
        }

        // Client
        prev.invClientName.innerHTML = sanitize(fields.clientName.value) || 'Client Name';
        prev.invClientCompany.innerHTML = sanitize(fields.clientCompany.value) || '';
        prev.invClientAddr.innerHTML = sanitize(fields.clientAddress.value).replace(/\n/g, '<br>') || '';

        let cContact = [];
        if (fields.clientEmail.value) cContact.push(sanitize(fields.clientEmail.value));
        if (fields.clientPhone.value) cContact.push(sanitize(fields.clientPhone.value));
        prev.invClientContact.innerHTML = cContact.join(' &bull; ');

        // Items table
        invTbody.innerHTML = '';
        let subtotal = 0;

        lineItems.forEach((item, i) => {
            const qty = Math.max(0, item.qty);
            const rate = Math.max(0, item.rate);
            const total = qty * rate;
            subtotal += total;
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td class="tc-num">${i + 1}</td>
        <td class="tc-desc">${sanitize(item.desc) || 'Item'}</td>
        <td class="tc-r">${sanitize(qty)}</td>
        <td class="tc-r">${formatMoney(rate)}</td>
        <td class="tc-r">${formatMoney(total)}</td>
      `;
            invTbody.appendChild(tr);
        });

        // Calculations
        const discPct = Math.max(0, Number(fields.discount.value || 0));
        const taxPct = Math.max(0, Number(fields.tax.value || 0));
        const shipCalc = Math.max(0, Number(fields.shipping.value || 0));

        const discountAmount = subtotal * (discPct / 100);
        const afterDisc = subtotal - discountAmount;
        const taxAmount = afterDisc * (taxPct / 100);
        const grandTotal = afterDisc + taxAmount + shipCalc;

        // Update Totals (Preview + Panel)
        const formattedSub = formatMoney(subtotal);
        const updateBoth = (idPrev, idSp, val) => {
            prev[idPrev].textContent = val;
            if (prev[idSp]) prev[idSp].textContent = val;
        };

        updateBoth('invSub', 'spSub', formattedSub);

        if (discPct > 0) {
            prev.invDiscRow.style.display = 'flex';
            prev.spDiscRow.style.display = 'flex';
            updateBoth('invDiscLbl', 'spDiscLbl', `Discount (${discPct}%)`);
            updateBoth('invDiscVal', 'spDiscVal', '-' + formatMoney(discountAmount));
        } else {
            prev.invDiscRow.style.display = 'none';
            prev.spDiscRow.style.display = 'none';
        }

        if (shipCalc > 0) {
            prev.invShipRow.style.display = 'flex';
            prev.spShipRow.style.display = 'flex';
            updateBoth('invShipVal', 'spShipVal', formatMoney(shipCalc));
        } else {
            prev.invShipRow.style.display = 'none';
            prev.spShipRow.style.display = 'none';
        }

        if (taxPct > 0) {
            prev.invTaxRow.style.display = 'flex';
            prev.spTaxRow.style.display = 'flex';
            updateBoth('invTaxLbl', 'spTaxLbl', `Tax (${taxPct}%)`);
            updateBoth('invTaxVal', 'spTaxVal', formatMoney(taxAmount));
        } else {
            prev.invTaxRow.style.display = 'none';
            prev.spTaxRow.style.display = 'none';
        }

        updateBoth('invGrand', 'spGrand', formatMoney(grandTotal));

        // Footer
        prev.invTerms.innerHTML = sanitize(fields.paymentTerms.value);
        prev.invNotes.innerHTML = sanitize(fields.notes.value).replace(/\n/g, '<br>');

        if (fields.bankDetails.value) {
            prev.invBank.style.display = 'block';
            prev.invBank.innerHTML = sanitize(fields.bankDetails.value).replace(/\n/g, '<br>');
        } else {
            prev.invBank.style.display = 'none';
        }

        // Refresh row totals in form
        const itemTotals = itemsContainer.querySelectorAll('.ir-total');
        itemTotals.forEach((el, i) => {
            if (lineItems[i]) {
                el.textContent = formatMoney(lineItems[i].qty * lineItems[i].rate);
            }
        });
    }

    // --- Export Functions ---

    // PNG
    function exportPNG() {
        showToast('Generating PNG...');
        const target = document.getElementById('invoicePage');
        html2canvas(target, { scale: 2, useCORS: true }).then(canvas => {
            const link = document.createElement('a');
            link.download = `Invoice_${fields.invoiceNumber.value}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('PNG Downloaded');
        });
    }

    // PDF
    function exportPDF() {
        showToast('Generating PDF...');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'pt', 'a4');

        // We capture the header/footer as image, and draw the table with jsPdf-AutoTable for best text quality
        // But since the new design is fairly custom, let's just html2canvas the whole sheet scaled into PDF.
        const target = document.getElementById('invoicePage');
        html2canvas(target, { scale: window.devicePixelRatio || 2, useCORS: true }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdfWidth = doc.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            doc.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            doc.save(`Invoice_${fields.invoiceNumber.value}.pdf`);
            showToast('PDF Downloaded');
        });
    }

    // Print
    function exportPrint() { window.print(); }

    // Clear
    function clearAll() {
        if (!confirm("Clear all data and start fresh?")) return;
        document.getElementById('invoiceForm').reset();
        lineItems = [{ desc: '', qty: 1, rate: 0 }];
        renderLineItemsForm();
        updatePreview();
        showToast('Cleared. Start fresh.');
    }

    // Attach buttons
    document.getElementById('pdfBtn').addEventListener('click', exportPDF);
    document.getElementById('sp-pdfBtn').addEventListener('click', exportPDF);
    document.getElementById('pngBtn').addEventListener('click', exportPNG);
    document.getElementById('sp-pngBtn').addEventListener('click', exportPNG);
    document.getElementById('printBtn').addEventListener('click', exportPrint);
    document.getElementById('sp-printBtn').addEventListener('click', exportPrint);
    document.getElementById('clearBtn').addEventListener('click', clearAll);

    // --- Toast ---
    let toastTimer;
    function showToast(msg) {
        const t = document.getElementById('toast');
        t.innerHTML = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
    }

    // Run on start
    renderLineItemsForm();
    updatePreview();

});
