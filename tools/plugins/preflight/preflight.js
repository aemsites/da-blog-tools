import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const scanNowBtn = document.getElementById('scan-now-btn');
    
    // Add click handler for Scan Now button
    scanNowBtn.addEventListener('click', async () => {
        await executeConfiguredTests();
    });
    
    // Load configuration on page load
    await loadConfiguration();
    
    async function loadConfiguration() {
        try {
            const { context, token, actions } = await DA_SDK;
            const response = await actions.daFetch(`${DA_ORIGIN}/config/${context.org}/${context.repo}/`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Extract only the preflight section
            const preflightData = data.preflight;
            
            if (preflightData && preflightData.data) {
                // Hide loading, show preflight data
                loadingEl.style.display = 'none';
                
                // Filter for only 'test' keys and create styled list
                const testItems = preflightData.data.filter(item => item.key === 'test');
                
                if (testItems.length > 0) {
                    const testsSection = document.getElementById('configured-tests-section');
                    const testsContent = document.getElementById('tests-content');
                    const testsHeading = document.getElementById('tests-heading');
                    const collapseIndicator = document.querySelector('.collapse-indicator');
                    
                    let testsList = '<ul class="test-list">';
                    testItems.forEach(item => {
                        testsList += `<li class="test-item">${item.value}</li>`;
                    });
                    testsList += '</ul>';
                    
                    testsContent.innerHTML = testsList;
                    testsSection.style.display = 'block';
                    
                    // Start collapsed by default
                    testsContent.style.display = 'none';
                    collapseIndicator.classList.add('collapsed');
                    
                    // Add click handler for collapse/expand
                    testsHeading.addEventListener('click', () => {
                        const isCollapsed = testsContent.style.display === 'none';
                        testsContent.style.display = isCollapsed ? 'block' : 'none';
                        collapseIndicator.classList.toggle('collapsed', !isCollapsed);
                    });
                    
                    // Store test items for later execution
                    window.configuredTestItems = testItems;
                } else {
                    const testsSection = document.getElementById('configured-tests-section');
                    const testsContent = document.getElementById('tests-content');
                    testsContent.textContent = 'No test configuration values found.';
                    testsSection.style.display = 'block';
                }
            } else {
                throw new Error('No preflight data found in response');
            }
            
        } catch (error) {
            // Hide loading, show error
            loadingEl.style.display = 'none';
            errorEl.textContent = `Error fetching configuration: ${error.message}`;
            errorEl.style.display = 'block';
            console.error('Error:', error);
        }
    }
    
    // Track test results for summary
    let totalTests = 0;
    let totalPasses = 0;
    let totalFails = 0;
    let totalUnknown = 0;

    // Execute all configured tests
    async function executeConfiguredTests() {
        // Clear previous results
        const resultsTbody = document.getElementById('results-tbody');
        resultsTbody.innerHTML = '';
        
        // Reset counters
        totalTests = 0;
        totalPasses = 0;
        totalFails = 0;
        totalUnknown = 0;
        
        // Add summary row at the top
        addSummaryRow();
        
        // Get the configured test items
        const testItems = window.configuredTestItems || [];
        
        if (testItems.length === 0) {
            console.log('No configured tests found');
            return;
        }
        
        console.log(`Executing ${testItems.length} configured tests...`);
        
        // Fetch page source before executing tests
        let pageSource = null;
        try {
            const { context, token, actions } = await DA_SDK;
            const pageSourceResponse = await actions.daFetch(`${DA_ORIGIN}/source/${context.org}/${context.repo}${context.path}.html`);
            
            if (pageSourceResponse.ok) {
                pageSource = await pageSourceResponse.text();
                console.log('Page source fetched successfully:', pageSource);
            } else {
                console.warn('Failed to fetch page source:', pageSourceResponse.status);
            }
        } catch (error) {
            console.error('Error fetching page source:', error);
        }
        
        // Show and setup results section
        const resultsSection = document.getElementById('test-results-section');
        
        resultsSection.style.display = 'block';
        
        // Start results section expanded by default and always visible
        const resultsContent = document.getElementById('results-content');
        resultsContent.style.display = 'block';
        
        for (const testItem of testItems) {
            try {
                console.log(`Running test: ${testItem.value}`);
                
                // Execute the test based on its value, passing the page source
                const result = await executeTest(testItem.value, pageSource);
                
                console.log(`Test ${testItem.value} result:`, result);
                
                // Add result to the table
                addResultToTable(testItem.value, result);
                
            } catch (error) {
                console.error(`Test ${testItem.value} failed:`, error);
                addResultToTable(testItem.value, { status: 'fail', message: error.message, location: 'N/A', remediation: 'Check console for details' });
            }
        }
        
        // Update summary with final counts
        updateSummaryRow();
        
        console.log('All tests completed');
    }

    function addSummaryRow() {
        const resultsTbody = document.getElementById('results-tbody');
        
        // Create summary row
        const summaryRow = document.createElement('tr');
        summaryRow.id = 'summary-row';
        summaryRow.className = 'summary-row';
        
        summaryRow.innerHTML = `
            <td colspan="4">
                <div class="summary-container">
                    <div class="summary-title">📊 Test Results Summary</div>
                    <div class="summary-stats">
                        <span class="summary-stat">
                            <span class="summary-label">Total Tests:</span>
                            <span class="summary-value" id="summary-total">0</span>
                        </span>
                        <span class="summary-stat">
                            <span class="summary-label">Passed:</span>
                            <span class="summary-value summary-pass" id="summary-passes">0</span>
                        </span>
                        <span class="summary-stat">
                            <span class="summary-label">Failed:</span>
                            <span class="summary-value summary-fail" id="summary-fails">0</span>
                        </span>
                        <span class="summary-stat">
                            <span class="summary-label">Unknown:</span>
                            <span class="summary-value summary-unknown" id="summary-unknown">0</span>
                        </span>
                    </div>
                </div>
            </td>
        `;
        
        resultsTbody.appendChild(summaryRow);
    }
    
    function updateSummaryRow() {
        document.getElementById('summary-total').textContent = totalTests;
        document.getElementById('summary-passes').textContent = totalPasses;
        document.getElementById('summary-fails').textContent = totalFails;
        document.getElementById('summary-unknown').textContent = totalUnknown;
    }

    // Add result to the results table
    function addResultToTable(testName, result) {
        const resultsTbody = document.getElementById('results-tbody');
        
        // Create a collapsible test group
        const testGroupRow = document.createElement('tr');
        testGroupRow.className = 'test-group-row';
        
        // Determine if all sub-tests pass (for auto-collapse)
        let allTestsPass = true;
        if (result.subTests && result.subTests.length > 0) {
            allTestsPass = result.subTests.every(subTest => subTest.status === 'pass');
        } else {
            allTestsPass = result.status === 'pass';
        }
        
        // Create the test group header row
        const statusIcon = result.status === 'pass' ? '✅' : 
                         result.status === 'fail' ? '❌' : '❓';
        
        testGroupRow.innerHTML = `
            <td colspan="4">
                <div class="test-group-header ${allTestsPass ? 'collapsed' : ''}" data-test-name="${testName}">
                    <div class="test-group-title">
                        <span class="collapse-indicator">${allTestsPass ? '▶' : '▼'}</span>
                        <strong>${testName}</strong>
                    </div>
                    <div class="test-group-status">
                        <span class="status-indicator status-${result.status}">${statusIcon} ${result.status.toUpperCase()}</span>
                    </div>
                </div>
                <div class="test-group-content ${allTestsPass ? 'collapsed' : ''}" data-test-name="${testName}">
                    <table class="test-details-table">
                        <tr class="parent-test-row">
                            <td><strong>${testName}</strong></td>
                            <td>${statusIcon}</td>
                            <td>${result.location || 'N/A'}</td>
                            <td>${result.remediation || 'N/A'}</td>
                        </tr>
                    </table>
                </div>
            </td>
        `;
        
        resultsTbody.appendChild(testGroupRow);
        
        // Add click handler for collapse/expand
        const groupHeader = testGroupRow.querySelector('.test-group-header');
        const groupContent = testGroupRow.querySelector('.test-group-content');
        const collapseIndicator = testGroupRow.querySelector('.collapse-indicator');
        
        groupHeader.addEventListener('click', () => {
            const isCollapsed = groupContent.classList.contains('collapsed');
            groupContent.classList.toggle('collapsed', !isCollapsed);
            groupHeader.classList.toggle('collapsed', !isCollapsed);
            collapseIndicator.textContent = isCollapsed ? '▼' : '▶';
        });
        
        // Add sub-tests if they exist
        if (result.subTests && result.subTests.length > 0) {
            const testDetailsTable = testGroupRow.querySelector('.test-details-table');
            
            result.subTests.forEach(subTest => {
                const subRow = document.createElement('tr');
                subRow.className = 'sub-test-row';
                
                const subStatusIcon = subTest.status === 'pass' ? '✅' : 
                                    subTest.status === 'fail' ? '❌' : '❓';
                
                // Format location as HTML list if it contains multiple items
                let locationHtml = subTest.location || 'N/A';
                if (subTest.status === 'fail' && subTest.location && subTest.location.includes('\n• ')) {
                    const items = subTest.location.split('\n• ');
                    if (items.length > 1) {
                        const listItems = items.map(item => `<li>${item}</li>`).join('');
                        locationHtml = `<ul class="location-list">${listItems}</ul>`;
                    }
                }
                
                subRow.innerHTML = `
                    <td style="padding-left: 30px;">└─ ${subTest.name}</td>
                    <td>${subStatusIcon}</td>
                    <td>${locationHtml}</td>
                    <td>${subTest.remediation || 'N/A'}</td>
                `;
                
                testDetailsTable.appendChild(subRow);
            });
        }
        
        // Update counters
        if (result.subTests && result.subTests.length > 0) {
            result.subTests.forEach(subTest => {
                totalTests++;
                if (subTest.status === 'pass') totalPasses++;
                else if (subTest.status === 'fail') totalFails++;
                else totalUnknown++;
            });
        } else {
            totalTests++;
            if (result.status === 'pass') totalPasses++;
            else if (result.status === 'fail') totalFails++;
            else totalUnknown++;
        }
        
        // Update summary after each test
        updateSummaryRow();
    }
    
    async function executeTest(testName, pageSource) {
        // This is where you would implement the actual test logic
        // For now, we'll just simulate some test execution
        // Dynamically import the test module
        try {
            const module = await import(`./tests/${testName}Test.js`);
            return await module.default(pageSource);
        } catch (error) {
            console.error(`Error loading test module for ${testName}:`, error);
            return { status: 'fail', message: `Failed to load test module: ${error.message}`, location: 'N/A', remediation: 'Check console for details' };
        }
    }
});
